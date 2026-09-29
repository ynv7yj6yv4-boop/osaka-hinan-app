// 地域判定基盤（Phase 2）: 近畿2府4県の行政区域境界データを、
// 地域判定APIで使う簡略化GeoJSONへ変換するスクリプト。
//
// 出典: 国土数値情報（行政区域データ, N03）（国土交通省）
//   https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html
//   利用規約: https://nlftp.mlit.go.jp/ksj/other/agreement.html （CC BY 4.0）
// 出典表記: 「国土数値情報（行政区域データ）（国土交通省）
//   https://nlftp.mlit.go.jp/ksj/ をもとに加工」
//
// 【重要・データの扱い】N03は市区町村単位のポリゴンだが、政令指定都市
// （大阪市・京都市・堺市・神戸市）は区単位で分かれて収録されている。
// このアプリでは区単位のデータを持たない（既存の避難所データ等も市単位）
// ため、区のポリゴンは市レベルのコード・名称へ丸め込んで統合する
// （DESIGNATED_CITY_CODE参照）。
//
// 生成される3つのファイル:
// - data/region-boundaries/kinki-municipalities.geojson
//     市区町村単位のポリゴン（Point in Polygonの主判定に使用）
// - data/region-boundaries/kinki-prefectures-buffered.geojson
//     都道府県単位のポリゴンをREGION_BOUNDARY_AMBIGUITY_BUFFER_METERS分
//     バッファしたもの（府県境付近のあいまいな判定を検出するための
//     補助レイヤー。2つ以上の都道府県のバッファ内に同時に入る地点は、
//     判定を"unknown"にする。バッファ距離はlib/region/regionBoundaryConfig.ts
//     で1か所だけ管理している）
// - data/region-boundaries/kinki-prefectures-buffered-cross-search.geojson
//     Phase 6 PART B: 都道府県単位のポリゴンをCROSS_PREFECTURE_SEARCH_
//     DISTANCE_METERS分バッファしたもの（府県境を越えた避難先候補検索を
//     行うべきかどうかの判定に使う。上記のambiguityバッファとは目的も
//     距離も異なる別レイヤー）
//
// 実行方法: node scripts/build-region-boundaries.mjs
// （ネットワークアクセスが必要。ダウンロードした生データ(約29MB)は
//  data/raw/n03-source/ に保存されるが、.gitignoreによりコミット対象外。
//  最終成果物(data/region-boundaries/*.geojson、合計約1.4MB)のみをコミットする。）

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import mapshaper from "mapshaper";
import { buildKinkiBounds } from "./build-kinki-bounds.mjs";
import {
  REGION_BOUNDARY_AMBIGUITY_BUFFER_METERS,
  CROSS_PREFECTURE_SEARCH_DISTANCE_METERS,
} from "../lib/region/regionBoundaryConfig.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const sourceDir = path.join(rootDir, "data", "raw", "n03-source");
const outDir = path.join(rootDir, "data", "region-boundaries");

// 近畿2府4県。三重県(24)は今回対象外だが、将来追加する場合はこの配列に
// 1件追加するだけでよい（lib/region/types.tsのPrefectureCode型も要更新）。
const PREFECTURES = [
  { code: "25", name: "滋賀県" },
  { code: "26", name: "京都府" },
  { code: "27", name: "大阪府" },
  { code: "28", name: "兵庫県" },
  { code: "29", name: "奈良県" },
  { code: "30", name: "和歌山県" },
];

const N03_EDITION = "N03-2026";
const N03_DATE = "20260101";

// 政令指定都市: 区(N03_005)のポリゴンを市レベルへ丸め込むための対応表。
// 【重要】この4市はいずれも近畿2府4県の主要都市であり、区単位のデータを
// 持たない既存の避難所データ等の粒度に合わせて意図的に市レベルへ統合する
// （区ごとの判定が必要になった場合は、この丸め込みをやめるだけでよい）。
const DESIGNATED_CITY_CODE = {
  京都市: "26100",
  大阪市: "27100",
  堺市: "27140",
  神戸市: "28100",
};

const PREF_CODE_BY_NAME = Object.fromEntries(PREFECTURES.map((p) => [p.name, p.code]));

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

async function downloadAndExtract(prefCode) {
  const zipUrl = `https://nlftp.mlit.go.jp/ksj/gml/data/N03/${N03_EDITION}/N03-${N03_DATE}_${prefCode}_GML.zip`;
  const zipPath = path.join(sourceDir, `${prefCode}.zip`);
  const extractDir = path.join(sourceDir, `extract_${prefCode}`);

  if (!existsSync(zipPath)) {
    console.log(`[${prefCode}] downloading ${zipUrl}`);
    const res = await fetch(zipUrl);
    if (!res.ok) throw new Error(`ダウンロードに失敗しました (${prefCode}): HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(zipPath, buf);
  }

  if (!existsSync(extractDir)) {
    mkdirSync(extractDir, { recursive: true });
    // Windows/macOS/Linuxいずれにも存在するunzipコマンドを利用する
    // （プロジェクトの他スクリプトと異なり外部データのzip展開が必要なため）。
    execFileSync("unzip", ["-o", "-q", zipPath, "-d", extractDir]);
  }

  const geojsonPath = path.join(extractDir, `N03-${N03_DATE}_${prefCode}.geojson`);
  return JSON.parse(readFileSync(geojsonPath, "utf-8"));
}

async function main() {
  ensureDir(sourceDir);
  ensureDir(outDir);

  const features = [];
  for (const { code } of PREFECTURES) {
    const data = await downloadAndExtract(code);
    for (const f of data.features) {
      const p = f.properties;
      const prefectureCode = PREF_CODE_BY_NAME[p.N03_001];
      if (!prefectureCode) {
        throw new Error(`未知の都道府県名です: ${p.N03_001}`);
      }
      const isWard = Boolean(p.N03_005);
      const municipalityCode = isWard ? DESIGNATED_CITY_CODE[p.N03_004] : p.N03_007;
      if (isWard && !municipalityCode) {
        throw new Error(`区データを持つが対応表に無い市です: ${p.N03_004}`);
      }
      features.push({
        type: "Feature",
        properties: {
          prefectureCode,
          prefectureName: p.N03_001,
          municipalityCode,
          municipalityName: p.N03_004,
        },
        geometry: f.geometry,
      });
    }
  }

  const mergedPath = path.join(sourceDir, "merged-raw.geojson");
  writeFileSync(mergedPath, JSON.stringify({ type: "FeatureCollection", features }));
  console.log(`merged ${features.length} features (dissolve前)`);

  // 市区町村単位: 区を市へdissolveしつつ、簡略化して軽量化する。
  const municipalitiesOut = path.join(outDir, "kinki-municipalities.geojson");
  await mapshaper.runCommands(
    `-i "${mergedPath}" ` +
      `-dissolve municipalityCode copy-fields=prefectureCode,prefectureName,municipalityName ` +
      `-simplify 3% keep-shapes ` +
      `-clean ` +
      `-o format=geojson precision=0.0001 "${municipalitiesOut}"`
  );

  // 都道府県単位＋バッファ（REGION_BOUNDARY_AMBIGUITY_BUFFER_METERS）:
  // 府県境付近のあいまいな地点を検出するための補助レイヤー。
  const bufferedOut = path.join(outDir, "kinki-prefectures-buffered.geojson");
  await mapshaper.runCommands(
    `-i "${mergedPath}" ` +
      `-dissolve prefectureCode copy-fields=prefectureName ` +
      `-simplify 3% keep-shapes ` +
      `-clean ` +
      `-buffer radius=${REGION_BOUNDARY_AMBIGUITY_BUFFER_METERS} geodesic ` +
      `-o format=geojson precision=0.0001 "${bufferedOut}"`
  );

  // Phase 6 PART B: 府県境検索用バッファ（CROSS_PREFECTURE_SEARCH_DISTANCE_METERS）。
  // 上記のambiguityバッファとは目的（判定のあいまいさ検出 vs 隣接候補検索の
  // トリガー）も距離も異なるため、別ファイルとして出力する。
  const crossSearchOut = path.join(outDir, "kinki-prefectures-buffered-cross-search.geojson");
  await mapshaper.runCommands(
    `-i "${mergedPath}" ` +
      `-dissolve prefectureCode copy-fields=prefectureName ` +
      `-simplify 3% keep-shapes ` +
      `-clean ` +
      `-buffer radius=${CROSS_PREFECTURE_SEARCH_DISTANCE_METERS} geodesic ` +
      `-o format=geojson precision=0.0001 "${crossSearchOut}"`
  );

  console.log("完了:");
  console.log(" -", municipalitiesOut);
  console.log(" -", bufferedOut);
  console.log(" -", crossSearchOut);

  // Phase 6 PART C: 初期地図表示範囲（境界データの外接矩形）も同じ境界データから再生成する。
  console.log(" -", buildKinkiBounds());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
