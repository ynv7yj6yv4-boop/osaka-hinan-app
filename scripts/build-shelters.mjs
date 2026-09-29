// 国土地理院「指定緊急避難場所・指定避難所データ」（都道府県内の全市町村）を
// アプリで使いやすいJSON形式に変換するスクリプト。
//
// 【Phase 4: 都道府県コードを引数に取る一般的な構造へ】従来は大阪府（27）
// 専用だったが、`node scripts/build-shelters.mjs 26`（京都府）・
// `node scripts/build-shelters.mjs 28`（兵庫県）のように、都道府県コードを
// 第1引数に指定して任意の近畿2府4県を処理できるよう一般化した
// （省略時は"27"＝大阪府。既存の呼び出し方との後方互換性を維持）。
// 対象市町村コードの一覧は lib/region の境界データ
// （data/region-boundaries/kinki-municipalities.geojson）から動的に取得する
// （ハードコードの二重管理を避ける）。出力先ファイル名は
// lib/region/types.ts の PREFECTURE_SLUGS から決める
// （例: 26→kyoto-prefecture-shelters.json）。
//
// 出典データ(基本): https://hinanmap.gsi.go.jp/hinanjocp/hinanbasho/koukaidate.html
// 生データは data/raw/ に保存している（利用規約は data/raw/gsi-notice.txt を参照）。
// ダウンロードURLパターン: https://hinanmap.gsi.go.jp/hinanjocp/defaultFtpData/csv/{市町村コード}_2.csv
// （指定緊急避難場所）／ https://hinanmap.gsi.go.jp/hinanjocp/defaultFtpData/csv/{市町村コード}_1.csv
// （指定避難所）。実際にPlaywrightでダウンロードページのJS(dlFile関数)を
// 解析して確認したURL構造（2026-09-29確認、全都道府県で共通のURL構造）。
// 実際のダウンロードは scripts/fetch-shelter-source-data.mjs（都道府県コード
// を引数に取る、Phase 3から一般化済み）が担当し、このスクリプトはdata/raw/の
// 既存CSVを変換するだけで、ネットワークアクセスは行わない。
//
// 【共通Shelter型への変換】lib/shelter/types.ts の Shelter 型で出力する。
// - shelterType: 指定緊急避難場所→"designated_emergency_evacuation_site"、
//   指定避難所→"designated_shelter"（今回のPhaseでは名寄せによる"both"化は行わない）。
// - supportedDisasters.flood: 指定緊急避難場所データは「洪水」列が
//   「該当は1、非該当は無記入」という明示的な行政判断のため、
//   1→true、無記入→false とする（unknownにしない）。指定避難所データには
//   災害種別の列自体が存在しないため、常に"unknown"とする
//   （詳細な理由は lib/shelter/types.ts のコメント参照）。
//
// 【避難所詳細情報の拡充（大阪市のみ）】大阪市「マップナビおおさか オープンデータ」
// （防災関連施設ポイントデータ）から、電話番号・避難可能時間・区名・分類を
// 補完する。この拡充データは大阪市にのみ存在する（京都府・兵庫県には
// 同等のオープンデータソースを今回調査・導入していない）ため、
// 大阪府（27）を処理する場合のみ実行する。
//
// 【名寄せの方針(安全側)】施設名の完全一致に頼らず、
// 「座標が近い(120m以内)」かつ「正規化した施設名が一致または包含関係にある」
// の両方を満たす場合のみ紐付ける（詳細は lib/shelterEnrichmentMatching.ts）。
//
// 【既存ファイルとの関係】旧・大阪市専用の public/data/osaka-shelters.json は
// このスクリプトではもう生成しない（このファイル自体は削除せず、移行中の
// 比較検証用として残している）。
//
// 実行方法: node scripts/build-shelters.mjs [都道府県コード]
//   例: node scripts/build-shelters.mjs 26  (京都府)

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { matchShelterEnrichment } from "../lib/shelterEnrichmentMatching.ts";
import { PREFECTURE_SLUGS } from "../lib/region/types.ts";
import { deduplicateShelters } from "../lib/shelter/deduplicateShelters.ts";
import { OFFICIALLY_NOT_PROVIDED } from "../lib/shelter/officialShelterDataGaps.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawDir = path.join(__dirname, "..", "data", "raw");
const boundaryPath = path.join(
  __dirname,
  "..",
  "data",
  "region-boundaries",
  "kinki-municipalities.geojson"
);

const PREFECTURE_CODE = process.argv[2] ?? "27";
const slug = PREFECTURE_SLUGS[PREFECTURE_CODE];
if (!slug) {
  console.error(`[build-shelters] 未対応の都道府県コードです: "${PREFECTURE_CODE}"（PREFECTURE_SLUGSに登録がありません）`);
  process.exit(1);
}
const outPath = path.join(__dirname, "..", "public", "data", `${slug}-prefecture-shelters.json`);

// ============================================================
// 対象市町村一覧（指定した都道府県内、lib/regionの境界データから取得）
// ============================================================

// 【重要・Phase 5で発見】末尾000の市町村コード（例: 和歌山県の
// "30000 所属未定地"）はscripts/fetch-shelter-source-data.mjsと同じ理由で
// 除外する（実在の市町村ではなく、GSI側では偶然その都道府県の集約データが
// 返るため。詳細は同スクリプトのコメント参照）。除外しないと、この集約
// データが重複除去処理で「正」として扱われ、実際の市町村コードを持つ
// レコードが誤って除去される。
const boundaries = JSON.parse(readFileSync(boundaryPath, "utf-8"));
const targetMunicipalities = boundaries.features
  .map((f) => f.properties)
  .filter((p) => p.prefectureCode === PREFECTURE_CODE)
  .filter((p) => !p.municipalityCode.endsWith("000"))
  .map((p) => ({ code: p.municipalityCode, name: p.municipalityName }))
  .sort((a, b) => a.code.localeCompare(b.code));

if (targetMunicipalities.length === 0) {
  console.error(`[build-shelters] 都道府県コード "${PREFECTURE_CODE}" の市町村が境界データに見つかりません。`);
  process.exit(1);
}

const PREFECTURE_NAME = boundaries.features.find(
  (f) => f.properties.prefectureCode === PREFECTURE_CODE
).properties.prefectureName;

console.log(`[build-shelters] 対象: ${PREFECTURE_NAME}（${PREFECTURE_CODE}） 市町村: ${targetMunicipalities.length}件`);

// ============================================================
// CSVパーサ（RFC4180準拠：ダブルクォートで囲まれたフィールド内の改行・カンマ・
// エスケープされたダブルクォート("")に対応する）。
// ============================================================
function parseCsvRows(text) {
  const src = text.replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (!(row.length === 1 && row[0] === "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
  }
  return rows;
}

function parseCsv(text) {
  const rows = parseCsvRows(text);
  const header = rows[0];
  return rows.slice(1).map((cols) => {
    const row = {};
    header.forEach((key, i) => {
      row[key] = cols[i] ?? "";
    });
    return row;
  });
}

function readCsvIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  return parseCsv(readFileSync(filePath, "utf-8"));
}

// ============================================================
// 市町村ごとにCSVを読み込み、共通Shelter型へ変換
// ============================================================

// 指定緊急避難場所データの災害種別列(表示用。洪水対応の判定には
// supportedDisasters.floodを使う。このHAZARD_COLUMNSは既存UI
// （対応災害バッジ等）との互換性のために引き続き全種別を収集する)。
const HAZARD_COLUMNS = {
  flood: "洪水",
  landslide: "崖崩れ、土石流及び地滑り",
  hightide: "高潮",
  earthquake: "地震",
  tsunami: "津波",
  fire: "大規模な火事",
  inundation: "内水氾濫",
  volcano: "火山現象",
};

const allFeatures = [];
const missingFiles = [];
// Phase 6 PART D: 市町村ごとに、公式CSV（指定緊急避難場所／指定避難所）を
// 実際に読み込めたかどうか（lib/shelter/dataCompleteness.ts参照）。
const datasetPresence = {};
let missingLatLngCount = 0;

for (const { code, name: municipalityName } of targetMunicipalities) {
  const kinkyuPath = path.join(rawDir, `${code}_shitei-kinkyu-hinanbasho.csv`);
  const hinanjoPath = path.join(rawDir, `${code}_shitei-hinanjo.csv`);

  const kinkyuRows = readCsvIfExists(kinkyuPath);
  const hinanjoRows = readCsvIfExists(hinanjoPath);

  if (!kinkyuRows) missingFiles.push(kinkyuPath);
  if (!hinanjoRows) missingFiles.push(hinanjoPath);
  datasetPresence[code] = { emergencyEvacuationSites: Boolean(kinkyuRows), designatedShelters: Boolean(hinanjoRows) };

  missingLatLngCount += (kinkyuRows ?? []).filter((row) => !row["緯度"] || !row["経度"]).length;
  missingLatLngCount += (hinanjoRows ?? []).filter((row) => !row["緯度"] || !row["経度"]).length;

  const evacuationSites = (kinkyuRows ?? [])
    .filter((row) => row["緯度"] && row["経度"])
    .map((row) => {
      const hazards = Object.entries(HAZARD_COLUMNS)
        .filter(([, col]) => row[col] === "1")
        .map(([key]) => key);
      return {
        id: row["共通ID"],
        name: row["施設・場所名"],
        lat: Number(row["緯度"]),
        lng: Number(row["経度"]),
        address: row["住所"] || undefined,
        prefectureCode: PREFECTURE_CODE,
        municipalityCode: code,
        prefectureName: PREFECTURE_NAME,
        municipalityName,
        shelterType: "designated_emergency_evacuation_site",
        supportedDisasters: { flood: row["洪水"] === "1" },
        hazards,
        source: "国土地理院 指定緊急避難場所データ",
      };
    });

  const shelters = (hinanjoRows ?? [])
    .filter((row) => row["緯度"] && row["経度"])
    .map((row) => ({
      id: row["共通ID"],
      name: row["施設・場所名"],
      lat: Number(row["緯度"]),
      lng: Number(row["経度"]),
      address: row["住所"] || undefined,
      prefectureCode: PREFECTURE_CODE,
      municipalityCode: code,
      prefectureName: PREFECTURE_NAME,
      municipalityName,
      shelterType: "designated_shelter",
      // 指定避難所データには災害種別の列が存在しないため、常にunknown
      // （lib/shelter/types.tsのコメント参照。「対応していない」と断定しない）。
      supportedDisasters: { flood: "unknown" },
      hazards: [],
      source: "国土地理院 指定避難所データ",
    }));

  allFeatures.push(...evacuationSites, ...shelters);
}

if (missingFiles.length > 0) {
  console.warn(`[build-shelters] 見つからなかった生データファイル: ${missingFiles.length}件`);
  for (const f of missingFiles) console.warn(`  - ${f}`);
}

// ============================================================
// 重複除去（同一の共通IDが複数市町村のCSVに含まれる場合、先勝ちで1件のみ残す）
// ============================================================

const seenIds = new Set();
const dedupedFeatures = [];
let duplicateCount = 0;
for (const f of allFeatures) {
  if (seenIds.has(f.id)) {
    duplicateCount++;
    continue;
  }
  seenIds.add(f.id);
  dedupedFeatures.push(f);
}

// ============================================================
// 大阪市「マップナビおおさか オープンデータ」による詳細情報の補完
// （大阪府（27）を処理する場合のみ。京都府・兵庫県には同等の
// オープンデータソースを今回導入していないため、telephone等は常にnullになる）
// ============================================================

let cityRows = [];
let cityMeta = null;
let featuresWithEnrichment;

if (PREFECTURE_CODE === "27") {
  const OSAKA_CITY_CSV_PATH = path.join(rawDir, "osaka-city-opendata-shelters.csv");
  try {
    const cityText = readFileSync(OSAKA_CITY_CSV_PATH, "utf-8");
    cityRows = parseCsv(cityText);
  } catch {
    console.warn(
      "[build-shelters] 大阪市オープンデータ(data/raw/osaka-city-opendata-shelters.csv)が見つからないため、詳細情報の補完をスキップします。"
    );
  }

  const cityRecords = cityRows
    .map((row) => ({
      name: row["場所の名前"],
      lat: Number(row["緯度"]),
      lng: Number(row["経度"]),
      telephone: row["TEL"],
      availableHours: row["避難可能時間"],
      ward: row["区名"],
      category: row["分類"],
    }))
    .filter((r) => r.lat && r.lng);

  // 補完の対象は大阪市（27100）のレコードのみ（大阪市オープンデータが
  // カバーするのは大阪市域のみのため、他市町村への誤補完を避ける）。
  const osakaCityFeatures = dedupedFeatures.filter((f) => f.municipalityCode === "27100");

  const { enrichmentByGsiId, report } = matchShelterEnrichment(osakaCityFeatures, cityRecords);

  featuresWithEnrichment = dedupedFeatures.map((f) => {
    const enrichment = enrichmentByGsiId.get(f.id);
    return {
      ...f,
      telephone: enrichment?.telephone ?? null,
      availableHours: enrichment?.availableHours ?? null,
      ward: enrichment?.ward ?? null,
      category: enrichment?.category ?? null,
    };
  });

  if (cityRows.length > 0) {
    cityMeta = {
      source: "大阪市 マップナビおおさか オープンデータ（防災関連施設ポイントデータ）",
      sourceUrl: "https://www.city.osaka.lg.jp/toshikeikaku/page/0000250227.html",
      license: "CC BY",
      coverage: "大阪市（27100）のレコードのみ補完（大阪市以外は telephone/availableHours/ward/category が常にnull）",
    };

    console.log("\n[build-shelters] 大阪市データによる名寄せレポート");
    console.log(`  大阪市データ件数: ${report.totalCityRecords}`);
    console.log(`  マッチ成功: ${report.matchedCount}`);
    console.log(`  未マッチ: ${report.unmatchedCount}`);
    console.log(`  あいまい(要手動確認・補完スキップ): ${report.ambiguousCount}`);
  }
} else {
  // 大阪府以外: 詳細情報の拡充データソースが無いため、常にnull(推測で埋めない)。
  featuresWithEnrichment = dedupedFeatures.map((f) => ({
    ...f,
    telephone: null,
    availableHours: null,
    ward: null,
    category: null,
  }));
}

// ============================================================
// 保守的な重複名寄せ（Phase 6 PART A。lib/shelter/deduplicateShelters.ts参照）
// ============================================================

const beforeDedupCount = featuresWithEnrichment.length;
const dedupResult = deduplicateShelters(featuresWithEnrichment);
featuresWithEnrichment = dedupResult.shelters;

console.log("\n[build-shelters] 重複名寄せ（保守的）");
console.log(`  名寄せ前総件数: ${beforeDedupCount}`);
console.log(`  名寄せ後総件数: ${featuresWithEnrichment.length}`);
console.log(`  自動統合したクラスタ数: ${dedupResult.mergedClusterCount}`);
console.log(`  統合により削減されたレコード数: ${dedupResult.mergedRecordCount}`);
console.log(`  自動統合しなかった近接同名ペア（要確認）: ${dedupResult.flaggedPairs.length}`);
if (dedupResult.flaggedPairs.length > 0) {
  for (const p of dedupResult.flaggedPairs) {
    console.log(
      `    - ${p.name}（${p.municipalityCode}, ${p.shelterType}）: ${p.id1} <-> ${p.id2}, 距離${p.distanceMeters.toFixed(1)}m, 理由:${p.reason}`
    );
  }
}

// ============================================================
// データ品質チェック
// ============================================================

const missingAddress = featuresWithEnrichment.filter((f) => !f.address).length;
const missingMunicipalityCode = featuresWithEnrichment.filter((f) => !f.municipalityCode).length;
const floodTrue = featuresWithEnrichment.filter((f) => f.supportedDisasters.flood === true).length;
const floodFalse = featuresWithEnrichment.filter((f) => f.supportedDisasters.flood === false).length;
const floodUnknown = featuresWithEnrichment.filter((f) => f.supportedDisasters.flood === "unknown").length;
const kinkyuCount = featuresWithEnrichment.filter(
  (f) => f.shelterType === "designated_emergency_evacuation_site"
).length;
const hinanjoCount = featuresWithEnrichment.filter((f) => f.shelterType === "designated_shelter").length;

// 市町村ごとのレコード0件チェック（取得はできたがCSVが空、等）。
const zeroRecordMunicipalities = targetMunicipalities.filter(
  ({ code }) => !featuresWithEnrichment.some((f) => f.municipalityCode === code)
);
const failedMunicipalityCodes = new Set(missingFiles.map((f) => path.basename(f).slice(0, 5)));

console.log("\n[build-shelters] データ品質チェック");
console.log(`  対象市町村数: ${targetMunicipalities.length}`);
console.log(`  取得失敗市町村数（生CSVが見つからない）: ${failedMunicipalityCodes.size}`);
console.log(`  取得成功市町村数: ${targetMunicipalities.length - failedMunicipalityCodes.size}`);
console.log(`  データ0件の市町村数: ${zeroRecordMunicipalities.length}`);
if (zeroRecordMunicipalities.length > 0) {
  for (const m of zeroRecordMunicipalities) console.log(`    - ${m.name}(${m.code})`);
}
console.log(`  総件数: ${featuresWithEnrichment.length}`);
console.log(`  指定緊急避難場所: ${kinkyuCount}`);
console.log(`  指定避難所: ${hinanjoCount}`);
console.log(`  洪水対応 true: ${floodTrue} / false: ${floodFalse} / unknown: ${floodUnknown}`);
console.log(`  緯度経度欠損（読み込み時に除外済み）: ${missingLatLngCount}`);
console.log(`  住所欠損: ${missingAddress}`);
console.log(`  市町村コード欠損: ${missingMunicipalityCode}`);
console.log(`  重複除去件数（同一共通IDが複数ファイルに存在）: ${duplicateCount}`);

const mergedFloodCandidateClusters = featuresWithEnrichment.filter(
  (f) =>
    (f.mergedFrom?.length ?? 0) > 1 &&
    f.shelterType === "designated_emergency_evacuation_site" &&
    f.supportedDisasters.flood === true
).length;
console.log(`  重複名寄せ: 洪水対応候補(flood=true)の統合クラスタ数: ${mergedFloodCandidateClusters}`);

// ============================================================
// JSON出力
// ============================================================

const output = {
  source: `国土地理院 指定緊急避難場所・指定避難所データ（${PREFECTURE_NAME}内${targetMunicipalities.length}市町村）`,
  sourceUrl: "https://hinanmap.gsi.go.jp/hinanjocp/hinanbasho/koukaidate.html",
  fetchedAt: new Date().toISOString().slice(0, 10),
  notice:
    "本データは各市町村の登録情報のため最新でない場合があります。詳細・最新情報は各市町村の発表をご確認ください。",
  enrichment: cityMeta,
  features: featuresWithEnrichment,
};

writeFileSync(outPath, JSON.stringify(output), "utf-8");

// ============================================================
// 市町村別の公式データ提供状況（Phase 6 PART D）
// ============================================================
// UI（lib/shelter/dataCompleteness.ts）がクライアント側で参照できるよう、
// 市町村ごとの「CSVを読み込めたか」だけを小さなTSファイルとして書き出す。
// CSVが無い市町村のうち、国土地理院が公式に「提供していない」と明記している
// もの（OFFICIALLY_NOT_PROVIDED）以外は、取得漏れの可能性として警告する
// （アプリ側でもその場合は"unavailable"ではなく"unknown"として扱う）。
const presenceConstName = `${slug.toUpperCase()}_SHELTER_DATASET_PRESENCE`;
const presenceOutPath = path.join(__dirname, "..", "lib", "shelter", "shelterDatasetPresence", `${slug}.generated.ts`);
const presenceLines = [
  "// このファイルは scripts/build-shelters.mjs が自動生成する（手で編集しないこと）。",
  `// ${PREFECTURE_NAME}の市町村ごとに、国土地理院の公式CSVをビルド時に読み込めたかどうか。`,
  "// 解釈（available/unavailable/unknown）は lib/shelter/dataCompleteness.ts を参照。",
  "",
  'import type { ShelterDatasetPresence } from "../dataCompleteness.ts";',
  "",
  `export const ${presenceConstName}: Record<string, ShelterDatasetPresence> = {`,
  ...Object.entries(datasetPresence).map(
    ([code, p]) =>
      `  "${code}": { emergencyEvacuationSites: ${p.emergencyEvacuationSites}, designatedShelters: ${p.designatedShelters} },`
  ),
  "};",
  "",
];
writeFileSync(presenceOutPath, presenceLines.join("\n"), "utf-8");

const partialMunicipalities = Object.entries(datasetPresence).filter(
  ([, p]) => !p.emergencyEvacuationSites || !p.designatedShelters
);
console.log(`\n[build-shelters] 市町村別の公式データ提供状況 -> ${presenceOutPath}`);
console.log(`  両CSVあり: ${Object.keys(datasetPresence).length - partialMunicipalities.length}市町村 / 片方以上なし: ${partialMunicipalities.length}市町村`);
for (const [code, p] of partialMunicipalities) {
  const missingKeys = Object.entries(p).filter(([, ok]) => !ok).map(([k]) => k);
  const official = missingKeys.every((k) => (OFFICIALLY_NOT_PROVIDED[code] ?? []).includes(k));
  console.log(
    `  - ${code}: ${missingKeys.join(",")}なし（${official ? "公式に未提供と確認済み" : "【警告】公式な未提供記録が無い。取得漏れの可能性"}）`
  );
}

console.log(
  `\n書き出し完了: ${output.features.length}件 (指定緊急避難場所 ${kinkyuCount} / 指定避難所 ${hinanjoCount}) -> ${outPath}`
);
