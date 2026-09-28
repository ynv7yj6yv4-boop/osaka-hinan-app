// 地域判定基盤（Phase 2）: クライアント側から地域判定を呼び出すための
// 薄いラッパー。実際のPoint in Polygon判定はサーバー側（app/api/region/route.ts）
// で行い、ここではその結果を取得するだけ（lib/evacuationRoute.tsが
// app/api/evacuation-route/route.tsを呼ぶのと同じ構成）。
//
// 旧 lib/osakaAreaCheck.ts の checkOsakaArea() を置き換えるもの。

import type { RegionCheckResult } from "./types";

export async function checkRegion(lat: number, lng: number): Promise<RegionCheckResult> {
  try {
    const res = await fetch(`/api/region?lat=${lat}&lng=${lng}`);
    const data = (await res.json()) as RegionCheckResult;
    if (!res.ok && data.status !== "error") {
      return { status: "error", message: "地域判定に失敗しました" };
    }
    return data;
  } catch {
    return { status: "error", message: "地域判定リクエストに失敗しました（通信環境をご確認ください）" };
  }
}
