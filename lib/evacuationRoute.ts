// Phase 5A: 徒歩の参考避難ルート取得（クライアント側）
//
// 実際のopenrouteservice呼び出しはサーバー側API Route（app/api/evacuation-route/route.ts）
// が行う。ここではそのAPI Routeを呼び出し、扱いやすい形に整形するだけ。
// APIキーはこのファイルには一切登場しない。
//
// 試作2（要件定義書2 §19・§31②）: ユーザー向け表示は従来どおり
// 「現在、徒歩経路を取得できません」程度の簡潔な文言のままとしつつ、
// 内部的に失敗理由を区別できるよう reason を保持する（開発者向けの原因切り分け用）。

import type { LatLng } from "./routeHazardEvaluation";

export type WalkingRoute = {
  distanceMeters: number;
  durationSeconds: number;
  geometry: LatLng[];
};

// app/api/evacuation-route/route.ts の RouteErrorReason と対応する内部区分。
// "no_route" のみクライアント側で判定する（応答は正常(200)だが経路が0件だった場合）。
export type RouteFetchErrorReason =
  | "api_key_missing"
  | "unauthorized"
  | "rate_limit"
  | "upstream_error"
  | "network_error"
  | "invalid_response"
  | "no_route";

const KNOWN_SERVER_REASONS: readonly RouteFetchErrorReason[] = [
  "api_key_missing",
  "unauthorized",
  "rate_limit",
  "upstream_error",
  "network_error",
  "invalid_response",
];

function isKnownServerReason(v: unknown): v is RouteFetchErrorReason {
  return typeof v === "string" && (KNOWN_SERVER_REASONS as readonly string[]).includes(v);
}

export type RouteFetchResult =
  | { status: "ok"; provider: string; routes: WalkingRoute[] }
  | { status: "error"; message: string; reason: RouteFetchErrorReason };

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
  } catch (err) {
    console.error("[fetchWalkingRoutes] 通信エラー", err);
    return {
      status: "error",
      message: "現在、徒歩経路を取得できません（通信エラー）",
      reason: "network_error",
    };
  }

  const data = await res.json().catch(() => null);

  if (!res.ok || !data) {
    const reason: RouteFetchErrorReason = isKnownServerReason(data?.reason)
      ? data.reason
      : "invalid_response";
    console.error("[fetchWalkingRoutes] ルート取得APIがエラーを返しました", {
      httpStatus: res.status,
      reason,
    });
    const message =
      reason === "rate_limit"
        ? "現在、徒歩経路を取得できません（混み合っている可能性があります。しばらくしてから再度お試しください）"
        : "現在、徒歩経路を取得できません";
    return { status: "error", message, reason };
  }

  const features = data.geojson?.features;
  if (!Array.isArray(features) || features.length === 0) {
    console.error("[fetchWalkingRoutes] 経路が見つかりませんでした", { reason: "no_route" });
    return { status: "error", message: "現在、徒歩経路を取得できません", reason: "no_route" };
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
