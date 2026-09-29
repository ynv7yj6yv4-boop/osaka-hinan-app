// 国土地理院「指定緊急避難場所・指定避難所データ」（大阪府内43市町村）を
// アプリで使いやすいJSON形式に変換するスクリプト。
//
// 【Phase 3: 大阪市→大阪府全域への拡張】従来は大阪市（市町村コード27100）のみを
// 対象にしていたが、大阪府内の全43市町村（大阪市・堺市・豊中市・吹田市・
// 東大阪市・高槻市・岸和田市・枚方市等）を対象とするよう一般化した。
// 対象市町村コードの一覧は lib/region の境界データ
// （data/region-boundaries/kinki-municipalities.geojson、
// prefectureCode==="27"）から動的に取得する（ハードコードの二重管理を避ける）。
//
// 出典データ(基本): https://hinanmap.gsi.go.jp/hinanjocp/hinanbasho/koukaidate.html
// 生データは data/raw/ に保存している（利用規約は data/raw/gsi-notice.txt を参照）。
// ダウンロードURLパターン: https://hinanmap.gsi.go.jp/hinanjocp/defaultFtpData/csv/{市町村コード}_2.csv
// （指定緊急避難場所）／ https://hinanmap.gsi.go.jp/hinanjocp/defaultFtpData/csv/{市町村コード}_1.csv
// （指定避難所）。実際にPlaywrightでダウンロードページのJS(dlFile関数)を
// 解析して確認したURL構造（2026-09-29確認）。
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
// 補完する。この拡充データは大阪市のみに存在するため、大阪市（27100）の
// レコードにのみ適用する（出典・ライセンス等は data/README.md 参照）。
//
// 【名寄せの方針(安全側)】施設名の完全一致に頼らず、
// 「座標が近い(120m以内)」かつ「正規化した施設名が一致または包含関係にある」
// の両方を満たす場合のみ紐付ける（詳細は lib/shelterEnrichmentMatching.ts）。
//
// 【既存ファイルとの関係】旧・大阪市専用の public/data/osaka-shelters.json は
// このスクリプトではもう生成しない（このファイル自体は削除せず、移行中の
// 比較検証用として残している）。生成先は public/data/osaka-prefecture-shelters.json。
//
// 実行方法: node scripts/build-shelters.mjs

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { matchShelterEnrichment } from "../lib/shelterEnrichmentMatching.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawDir = path.join(__dirname, "..", "data", "raw");
const outPath = path.join(__dirname, "..", "public", "data", "osaka-prefecture-shelters.json");
const boundaryPath = path.join(
  __dirname,
  "..",
  "data",
  "region-boundaries",
  "kinki-municipalities.geojson"
);

// ============================================================
// 対象市町村一覧（大阪府内、lib/regionの境界データから取得）
// ============================================================

const boundaries = JSON.parse(readFileSync(boundaryPath, "utf-8"));
const osakaMunicipalities = boundaries.features
  .map((f) => f.properties)
  .filter((p) => p.prefectureCode === "27")
  .map((p) => ({ code: p.municipalityCode, name: p.municipalityName }))
  .sort((a, b) => a.code.localeCompare(b.code));

console.log(`[build-shelters] 対象市町村: ${osakaMunicipalities.length}件`);

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

const PREFECTURE_CODE = "27";
const PREFECTURE_NAME = "大阪府";

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
let missingLatLngCount = 0;

for (const { code, name: municipalityName } of osakaMunicipalities) {
  const kinkyuPath = path.join(rawDir, `${code}_shitei-kinkyu-hinanbasho.csv`);
  const hinanjoPath = path.join(rawDir, `${code}_shitei-hinanjo.csv`);

  const kinkyuRows = readCsvIfExists(kinkyuPath);
  const hinanjoRows = readCsvIfExists(hinanjoPath);

  if (!kinkyuRows) missingFiles.push(kinkyuPath);
  if (!hinanjoRows) missingFiles.push(hinanjoPath);

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
// 大阪市「マップナビおおさか オープンデータ」による詳細情報の補完（大阪市のみ）
// ============================================================

const OSAKA_CITY_CSV_PATH = path.join(rawDir, "osaka-city-opendata-shelters.csv");

let cityRows = [];
let cityMeta = null;
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

const featuresWithEnrichment = dedupedFeatures.map((f) => {
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

console.log("\n[build-shelters] データ品質チェック");
console.log(`  総件数: ${featuresWithEnrichment.length}`);
console.log(`  指定緊急避難場所: ${kinkyuCount}`);
console.log(`  指定避難所: ${hinanjoCount}`);
console.log(`  洪水対応 true: ${floodTrue} / false: ${floodFalse} / unknown: ${floodUnknown}`);
console.log(`  緯度経度欠損（読み込み時に除外済み）: ${missingLatLngCount}`);
console.log(`  住所欠損: ${missingAddress}`);
console.log(`  市町村コード欠損: ${missingMunicipalityCode}`);
console.log(`  重複除去件数（同一共通IDが複数ファイルに存在）: ${duplicateCount}`);

// ============================================================
// JSON出力
// ============================================================

const output = {
  source: `国土地理院 指定緊急避難場所・指定避難所データ（大阪府内${osakaMunicipalities.length}市町村）`,
  sourceUrl: "https://hinanmap.gsi.go.jp/hinanjocp/hinanbasho/koukaidate.html",
  fetchedAt: "2026-09-29",
  notice:
    "本データは各市町村の登録情報のため最新でない場合があります。詳細・最新情報は各市町村の発表をご確認ください。",
  enrichment: cityMeta,
  features: featuresWithEnrichment,
};

writeFileSync(outPath, JSON.stringify(output), "utf-8");

console.log(
  `\n書き出し完了: ${output.features.length}件 (指定緊急避難場所 ${kinkyuCount} / 指定避難所 ${hinanjoCount}) -> ${outPath}`
);
