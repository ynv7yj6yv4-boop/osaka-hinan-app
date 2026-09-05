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

// CSVパーサ（RFC4180準拠：ダブルクォートで囲まれたフィールド内の改行・カンマ・
// エスケープされたダブルクォート("")に対応する）。
//
// 【修正の経緯】以前は単純な split("\n") / split(",") を使っていたが、
// 大阪市の元データには施設名が長くダブルクォートで囲み、名前の途中で
// 改行しているレコードが存在する（例：「特別養護老人ホーム「ライフライト」
// 並びにケアハウス「ライフフェア」」）。単純split ではこの改行で
// レコードが分断され、後続の列がズレて誤ったハザード対応データに
// なってしまっていた（詳細はコミット履歴・Phase5設計報告を参照）。
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
  // 末尾に改行がない場合の最終フィールド・行を回収
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
