// 地域判定基盤（Phase 2）: 境界GeoJSON（data/region-boundaries/）の読み込み。
//
// 【重要】このファイルはNode.jsのfsを使うため、サーバー側専用
// （API route等）でのみimportすること。クライアント（"use client"付き
// コンポーネント）からは呼ばない。データ自体もクライアントへは配信せず、
// サーバー側でPoint in Polygon判定した「結果」だけを返す設計にしている
// （巨大な境界データをクライアントへ毎回読み込ませないため）。

import { readFileSync } from "node:fs";
import path from "node:path";
import type { RegionBoundaryData } from "./regionLookup.ts";

let cached: RegionBoundaryData | null = null;

export function loadRegionBoundaries(): RegionBoundaryData {
  if (cached) return cached;

  const dir = path.join(process.cwd(), "data", "region-boundaries");
  const municipalities = JSON.parse(readFileSync(path.join(dir, "kinki-municipalities.geojson"), "utf-8"));
  const bufferedPrefectures = JSON.parse(
    readFileSync(path.join(dir, "kinki-prefectures-buffered.geojson"), "utf-8")
  );
  // Phase 6 PART B: 府県境を越えた避難先候補検索のトリガー判定用
  // （lib/region/regionBoundaryConfig.tsのCROSS_PREFECTURE_SEARCH_DISTANCE_METERS）。
  const crossSearchBufferedPrefectures = JSON.parse(
    readFileSync(path.join(dir, "kinki-prefectures-buffered-cross-search.geojson"), "utf-8")
  );

  cached = { municipalities, bufferedPrefectures, crossSearchBufferedPrefectures };
  return cached;
}
