// 国土地理院「指定緊急避難場所・指定避難所データ」（大阪市, 市町村コード27100）を
// アプリで使いやすいJSON形式に変換するスクリプト。
//
// 出典データ: https://hinanmap.gsi.go.jp/hinanjocp/hinanbasho/koukaidate.html
// 生データは data/raw/ に保存している（利用規約は data/raw/gsi-notice.txt を参照）。
//
// 実行方法: node scripts/build-shelters.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawDir = path.join(__dirname, "..", "data", "raw");
const outPath = path.join(__dirname, "..", "public", "data", "osaka-shelters.json");

// 簡易CSVパーサ（このデータはフィールド内にカンマ・改行を含まないため単純split で十分）
function parseCsv(text) {
  const lines = text.replace(/^﻿/, "").split(/\r\n|\n/).filter((l) => l.length > 0);
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cols = line.split(",");
    const row = {};
    header.forEach((key, i) => {
      row[key] = cols[i] ?? "";
    });
    return row;
  });
}

// 指定緊急避難場所（災害種別ごとの対応可否あり）
const kinkyuText = readFileSync(
  path.join(rawDir, "27100_shitei-kinkyu-hinanbasho.csv"),
  "utf-8"
);
const kinkyuRows = parseCsv(kinkyuText);

// 指定避難所（一定期間滞在するための施設。災害種別の区分なし）
const hinanjoText = readFileSync(path.join(rawDir, "27100_shitei-hinanjo.csv"), "utf-8");
const hinanjoRows = parseCsv(hinanjoText);

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

const evacuationSites = kinkyuRows
  .filter((row) => row["緯度"] && row["経度"])
  .map((row) => {
    const hazards = Object.entries(HAZARD_COLUMNS)
      .filter(([, col]) => row[col] === "1")
      .map(([key]) => key);
    return {
      id: row["共通ID"],
      type: "evacuation_site", // 指定緊急避難場所
      name: row["施設・場所名"],
      address: row["住所"],
      lat: Number(row["緯度"]),
      lng: Number(row["経度"]),
      hazards,
    };
  });

const shelters = hinanjoRows
  .filter((row) => row["緯度"] && row["経度"])
  .map((row) => ({
    id: row["共通ID"],
    type: "shelter", // 指定避難所
    name: row["施設・場所名"],
    address: row["住所"],
    lat: Number(row["緯度"]),
    lng: Number(row["経度"]),
    hazards: [],
  }));

const output = {
  source: "国土地理院 指定緊急避難場所・指定避難所データ（大阪市, 27100）",
  sourceUrl: "https://hinanmap.gsi.go.jp/hinanjocp/hinanbasho/koukaidate.html",
  fetchedAt: "2026-09-06",
  notice:
    "本データは各市町村の登録情報のため最新でない場合があります。詳細・最新情報は大阪市の発表をご確認ください。",
  features: [...evacuationSites, ...shelters],
};

writeFileSync(outPath, JSON.stringify(output), "utf-8");

console.log(
  `書き出し完了: ${output.features.length}件 (避難場所 ${evacuationSites.length} / 避難所 ${shelters.length}) -> ${outPath}`
);
