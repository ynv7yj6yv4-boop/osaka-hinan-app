// 地域判定基盤（Phase 2）: 緯度経度から近畿2府4県の都道府県・市区町村を
// 判定するサーバー側API Route。
//
// 【重要】行政区域の境界データ（data/region-boundaries/、約1.4MB）は
// このサーバー側でのみ読み込み、クライアントへは判定結果のJSONのみを
// 返す（巨大な境界データをクライアントへ毎回読み込ませないため）。
// 判定ロジック本体（Point in Polygon）はlib/region/regionLookup.tsの
// 純粋関数を使用し、ここではHTTPの入出力のみを担当する。

import { NextResponse } from "next/server";
import { loadRegionBoundaries } from "@/lib/region/loadBoundaries";
import { lookupRegion } from "@/lib/region/regionLookup";
import type { RegionCheckResult } from "@/lib/region/types";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const latParam = searchParams.get("lat");
  const lngParam = searchParams.get("lng");

  const lat = latParam ? Number(latParam) : NaN;
  const lng = lngParam ? Number(lngParam) : NaN;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    const result: RegionCheckResult = { status: "error", message: "lat/lngが不正です" };
    return NextResponse.json(result, { status: 400 });
  }

  try {
    const boundaries = loadRegionBoundaries();
    const result = lookupRegion(lat, lng, boundaries);
    return NextResponse.json(result);
  } catch (err) {
    const result: RegionCheckResult = {
      status: "error",
      message: err instanceof Error ? err.message : "地域判定に失敗しました",
    };
    return NextResponse.json(result, { status: 500 });
  }
}
