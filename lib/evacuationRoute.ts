// Phase 5A: 徒歩の参考避難ルート取得（クライアント側）
//
// 実際のopenrouteservice呼び出しはサーバー側API Route（app/api/evacuation-route/route.ts）
// が行う。ここではそのAPI Routeを呼び出し、扱いやすい形に整形するだけ。
// APIキーはこのファイルには一切登場しない。

import type { LatLng } from "./routeHazardEvaluation";

export type WalkingRoute = {
  distanceMeters: number;
  durationSeconds: number;
  geometry: LatLng[];
};

export type RouteFetchResult =
  | { status: "ok"; provider: string; routes: WalkingRoute[] }
  | { status: "error"; message: string };

export async function fetchWalkingRoutes(
  origin: LatLng,
  destination: LatLng
): Promise<RouteFetchResult> {
  let res: Response;
  try {
    res = await fetch("/api/evacuation-route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origin, destination }),
    });
  } catch {
    return { status: "error", message: "現在、徒歩経路を取得できません（通信エラー）" };
  }

  const data = await res.json().catch(() => null);

  if (!res.ok || !data) {
    return { status: "error", message: "現在、徒歩経路を取得できません" };
  }

  const features = data.geojson?.features;
  if (!Array.isArray(features) || features.length === 0) {
    return { status: "error", message: "現在、徒歩経路を取得できません" };
  }

  const routes: WalkingRoute[] = features.map(
    (f: { properties?: { summary?: { distance?: number; duration?: number } }; geometry?: { coordinates?: [number, number][] } }) => ({
      distanceMeters: f.properties?.summary?.distance ?? 0,
      durationSeconds: f.properties?.summary?.duration ?? 0,
      geometry: (f.geometry?.coordinates ?? []).map(([lng, lat]) => ({ lat, lng })),
    })
  );

  return { status: "ok", provider: data.provider ?? "openrouteservice", routes };
}
