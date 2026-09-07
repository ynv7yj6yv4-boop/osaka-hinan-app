// Phase 5A: 徒歩の参考避難ルート取得（クライアント側）
//
// 実際のopenrouteservice呼び出しはサーバー側API Route（app/api/evacuation-route/route.ts）
// が行う。ここではそのAPI Routeを呼び出し、扱いやすい形に整形するだけ。
// APIキーはこのファイルには一切登場しない。
//
// 試作2（要件定義書2 §19・§31②）: ユーザー向け表示は従来どおり
// 「現在、徒歩経路を取得できません」程度の簡潔な文言のままとしつつ、
// 内部的に失敗理由を区別できるよう reason を保持する（開発者向けの原因切り分け用）。
//
// 試作3 PART A-2（要件定義書2）: openrouteserviceのレスポンスに含まれる
// 案内情報(steps)を保持するようにした。
// 【重要】リクエスト内容(app/api/evacuation-route/route.ts)は一切変更していない。
// 実際にAPIへ問い合わせて確認したところ、instructionsパラメータを指定しなくても
// ORSはデフォルトで properties.segments[0].steps を返しており、既存のルート
// 取得を壊さずに追加取得できることを確認済み（詳細はチャット記録参照）。
// なお、ORSの言語パラメータ(language)には依存しない。日本語での案内文言は
// lib/navigation.ts 側で、ここに保持する type(数値の曲がり方コード)・
// streetName・distanceMeters から独自に組み立てる。

import type { LatLng } from "./routeHazardEvaluation";

/** openrouteserviceのstep 1件（区間ごとの案内情報）。 */
export type RouteStep = {
  /** ORS公式ドキュメントで仕様が確定している曲がり方コード(0〜13)。
   *  lib/navigation.ts の describeStep() で日本語文言に変換する。 */
  type: number;
  /** ORSが返す英語の案内文（そのまま保持するのみで、UIでは使用しない） */
  instructionEn: string;
  /** この区間の距離(m) */
  distanceMeters: number;
  /** この区間の推定所要時間(秒) */
  durationSeconds: number;
  /** 道路名（ORSが"-"を返す場合はnullに正規化） */
  streetName: string | null;
  /** geometry配列内の [開始頂点インデックス, 終了頂点インデックス] */
  wayPoints: [number, number];
};

export type WalkingRoute = {
  distanceMeters: number;
  durationSeconds: number;
  geometry: LatLng[];
  steps: RouteStep[];
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

  type OrsFeature = {
    properties?: {
      summary?: { distance?: number; duration?: number };
      segments?: {
        steps?: {
          type?: number;
          instruction?: string;
          distance?: number;
          duration?: number;
          name?: string;
          way_points?: [number, number];
        }[];
      }[];
    };
    geometry?: { coordinates?: [number, number][] };
  };

  const routes: WalkingRoute[] = (features as OrsFeature[]).map((f) => {
    const rawSteps = f.properties?.segments?.[0]?.steps ?? [];
    const steps: RouteStep[] = rawSteps.map((s) => ({
      type: s.type ?? -1,
      instructionEn: s.instruction ?? "",
      distanceMeters: s.distance ?? 0,
      durationSeconds: s.duration ?? 0,
      streetName: s.name && s.name !== "-" ? s.name : null,
      wayPoints: s.way_points ?? [0, 0],
    }));

    return {
      distanceMeters: f.properties?.summary?.distance ?? 0,
      durationSeconds: f.properties?.summary?.duration ?? 0,
      geometry: (f.geometry?.coordinates ?? []).map(([lng, lat]) => ({ lat, lng })),
      steps,
    };
  });

  return { status: "ok", provider: data.provider ?? "openrouteservice", routes };
}
