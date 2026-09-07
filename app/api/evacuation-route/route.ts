// Phase 5A: 徒歩の参考避難ルートをopenrouteserviceから取得するサーバー側API Route。
//
// 【重要】openrouteserviceのAPIキーはこのサーバー側コードでのみ使用し、
// クライアント（ブラウザ）には一切渡さない。キーは環境変数
// OPENROUTESERVICE_API_KEY で管理する（NEXT_PUBLIC_ にはしない）。
//
// 出典・利用規約・エンドポイントの検証記録は data/README.md を参照。
//
// 試作2（要件定義書2 §19・§31②）: 本番(Vercel)でルート取得が失敗する問題の
// 調査・再発防止のため、失敗理由を区別できる `reason` を返すようにした。
// 【重要】ユーザー向け表示文言は変更しない（"現在、徒歩経路を取得できません"程度で
// 十分、という既存方針のまま）。reasonはあくまで開発者向けの内部区分であり、
// エンドポイント・APIキーの扱い・取得ロジック自体は変更していない。

import { NextResponse } from "next/server";

// 2026年時点の正式エンドポイント（api.heigit.org）。
// 古い api.openrouteservice.org は使用しない（ユーザーとの合意事項）。
const ORS_ENDPOINT_BASE = "https://api.heigit.org/openrouteservice/v2/directions";

type LatLng = { lat: number; lng: number };

// 試作2で追加: ルート取得失敗の内部区分。
// クライアント側(lib/evacuationRoute.ts)の同名の型と対応している。
export type RouteErrorReason =
  | "api_key_missing" // Vercel等にOPENROUTESERVICE_API_KEYが設定されていない
  | "unauthorized" // openrouteserviceがキーを拒否した（401/403）
  | "rate_limit" // openrouteserviceのレート制限（429）
  | "upstream_error" // 上記以外のopenrouteservice側エラー
  | "network_error" // このサーバーからopenrouteserviceへ接続できなかった
  | "invalid_response"; // リクエスト内容が不正、またはopenrouteserviceの応答を解釈できなかった

function isValidLatLng(v: unknown): v is LatLng {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as LatLng).lat === "number" &&
    typeof (v as LatLng).lng === "number" &&
    Number.isFinite((v as LatLng).lat) &&
    Number.isFinite((v as LatLng).lng)
  );
}

// APIキーそのものは絶対に含めず、原因の切り分けに必要な情報だけをサーバーログ
// （Vercelの Function Logs 等）に残す。ユーザー向けレスポンスの文言はここでは決めない。
function logRouteError(reason: RouteErrorReason, detail?: Record<string, unknown>) {
  console.error("[evacuation-route] ルート取得に失敗しました", { reason, ...detail });
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTESERVICE_API_KEY;
  if (!apiKey) {
    logRouteError("api_key_missing");
    // ビルドは壊さず、実行時にだけ分かるエラーとして返す（開発者向けメッセージ）。
    return NextResponse.json(
      {
        error: "ルーティングAPIが設定されていません（OPENROUTESERVICE_API_KEYが未設定です）",
        reason: "api_key_missing" satisfies RouteErrorReason,
      },
      { status: 500 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "リクエストの形式が不正です", reason: "invalid_response" satisfies RouteErrorReason },
      { status: 400 }
    );
  }

  const { origin, destination } = (body ?? {}) as { origin?: unknown; destination?: unknown };
  if (!isValidLatLng(origin) || !isValidLatLng(destination)) {
    return NextResponse.json(
      {
        error: "origin/destination（lat, lng）が必要です",
        reason: "invalid_response" satisfies RouteErrorReason,
      },
      { status: 400 }
    );
  }

  // openrouteserviceは [経度, 緯度] の順（GeoJSON標準の順序）で座標を渡す
  const requestBody = {
    coordinates: [
      [origin.lng, origin.lat],
      [destination.lng, destination.lat],
    ],
    alternative_routes: {
      target_count: 3, // openrouteserviceの上限も3
      share_factor: 0.6,
      weight_factor: 1.6,
    },
  };

  let orsResponse: Response;
  try {
    orsResponse = await fetch(`${ORS_ENDPOINT_BASE}/foot-walking/geojson`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
      },
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    logRouteError("network_error", { message: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      {
        error: "ルーティングAPIへの接続に失敗しました（通信エラー）",
        reason: "network_error" satisfies RouteErrorReason,
      },
      { status: 502 }
    );
  }

  if (!orsResponse.ok) {
    // openrouteservice側のエラー内容をそのまま握りつぶさず、状況が分かる形で返す
    const text = await orsResponse.text().catch(() => "");
    // HTTPステータスから、よくある原因（キー拒否・レート制限）だけは区別する。
    // それ以外は一律 upstream_error とし、詳細はログのtext(先頭500字)を参照する。
    const reason: RouteErrorReason =
      orsResponse.status === 401 || orsResponse.status === 403
        ? "unauthorized"
        : orsResponse.status === 429
          ? "rate_limit"
          : "upstream_error";
    logRouteError(reason, { upstreamStatus: orsResponse.status, detail: text.slice(0, 500) });
    return NextResponse.json(
      {
        error: `ルーティングAPIがエラーを返しました（status: ${orsResponse.status}）`,
        detail: text.slice(0, 500),
        reason,
      },
      { status: 502 }
    );
  }

  let geojson: unknown;
  try {
    geojson = await orsResponse.json();
  } catch (err) {
    logRouteError("invalid_response", { message: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      {
        error: "ルーティングAPIの応答を解釈できませんでした",
        reason: "invalid_response" satisfies RouteErrorReason,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ provider: "openrouteservice", geojson });
}
