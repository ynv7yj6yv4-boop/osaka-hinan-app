// Phase 3: 国土地理院「指定緊急避難場所・指定避難所データ」の生CSVを
// data/raw/ へダウンロードするスクリプト。
//
// 【背景】scripts/build-shelters.mjs はdata/raw/内の既存CSVを変換するだけの
// 純粋なスクリプトであり、ネットワークアクセスを行わない。今回（大阪府43
// 市町村分）の実際の取得は、このスクリプトを書く前に手動のcurlループで
// 行っていたため、再取得の手順がコード化されていなかった。再現性のため、
// 取得手順自体をこのスクリプトとして残す。
//
// 【ダウンロードURLの構造】ダウンロードページ
// (https://hinanmap.gsi.go.jp/hinanjocp/hinanbasho/koukaidate.html) は
// JS(dlFile関数)でZIPを組み立てて配信するUIになっているが、実際に
// フェッチしているCSV本体のURLはシンプルな規則を持つ
// （2026-09-29にPlaywrightでdlFile関数のソースを確認）:
//   指定緊急避難場所: https://hinanmap.gsi.go.jp/hinanjocp/defaultFtpData/csv/{市町村コード}_2.csv
//   指定避難所      : https://hinanmap.gsi.go.jp/hinanjocp/defaultFtpData/csv/{市町村コード}_1.csv
//
// 【対象市町村】data/region-boundaries/kinki-municipalities.geojson から、
// 指定した都道府県コードの市町村一覧を動的に取得する（ハードコードしない）。
// 今回のPhase 3では大阪府（27）のみ実行しているが、将来 京都府・兵庫県等
// （近畿2府4県のいずれか）を追加する際もこのスクリプトをそのまま
// `node scripts/fetch-shelter-source-data.mjs 26` のように呼び出すだけで
// 対応できる（第1引数省略時は"27"）。
//
// 実行方法: node scripts/fetch-shelter-source-data.mjs [都道府県コード]

import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawDir = path.join(__dirname, "..", "data", "raw");
const boundaryPath = path.join(
  __dirname,
  "..",
  "data",
  "region-boundaries",
  "kinki-municipalities.geojson"
);

const prefectureCode = process.argv[2] ?? "27";

// 【重要・Phase 5で発見】市町村コードが「000」で終わる境界データ
// （例: 和歌山県の"30000 所属未定地"）は、実在する市町村ではなく
// 行政区域が未確定な土地を表すN03の特殊カテゴリであり、実際に個別の
// 避難所指定を持つ主体ではない。かつ、この"30000"はGSIのCSV配信URL
// (defaultFtpData/csv/30000_2.csv 等)では偶然、和歌山県内の全市町村分を
// 束ねた集約データが返ってくることを実際に確認した（他の都道府県では
// この末尾000のコードは境界データに存在しない）。これを通常の市町村と
// 同様に個別取得すると、共通IDが重複した集約データと個別市町村データが
// 混在し、後段のbuild-shelters.mjsでの重複除去処理が「集約データ側を
// 正」として個別市町村のmunicipalityCode（正しい市町村コード）を
// 持つレコードを誤って除去してしまう（実際に和歌山県で確認・修正した
// 不具合）。そのため、末尾000の市町村コードは取得対象から除外する。
const boundaries = JSON.parse(readFileSync(boundaryPath, "utf-8"));
const municipalities = boundaries.features
  .map((f) => f.properties)
  .filter((p) => p.prefectureCode === prefectureCode)
  .filter((p) => !p.municipalityCode.endsWith("000"))
  .map((p) => ({ code: p.municipalityCode, name: p.municipalityName }))
  .sort((a, b) => a.code.localeCompare(b.code));

if (municipalities.length === 0) {
  console.error(`[fetch-shelter-source-data] 都道府県コード "${prefectureCode}" の市町村が境界データに見つかりません。`);
  process.exit(1);
}

console.log(`[fetch-shelter-source-data] 対象: ${municipalities.length}市町村（都道府県コード${prefectureCode}）`);

async function fetchCsv(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

let successCount = 0;
let failCount = 0;

for (const { code, name } of municipalities) {
  const targets = [
    { suffix: "_2", outName: `${code}_shitei-kinkyu-hinanbasho.csv`, label: "指定緊急避難場所" },
    { suffix: "_1", outName: `${code}_shitei-hinanjo.csv`, label: "指定避難所" },
  ];
  for (const { suffix, outName, label } of targets) {
    const url = `https://hinanmap.gsi.go.jp/hinanjocp/defaultFtpData/csv/${code}${suffix}.csv`;
    try {
      const buf = await fetchCsv(url);
      writeFileSync(path.join(rawDir, outName), buf);
      successCount++;
    } catch (e) {
      console.error(`[fetch-shelter-source-data] 失敗: ${name}(${code}) ${label} — ${e.message}`);
      failCount++;
    }
  }
}

console.log(`[fetch-shelter-source-data] 完了: 成功${successCount}件 / 失敗${failCount}件`);
if (failCount > 0) process.exitCode = 1;
