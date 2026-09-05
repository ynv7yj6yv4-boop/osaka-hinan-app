// Phase 5A: 徒歩の参考避難ルートをopenrouteserviceから取得するサーバー側API Route。
//
// 【重要】openrouteserviceのAPIキーはこのサーバー側コードでのみ使用し、
// クライアント（ブラウザ）には一切渡さない。キーは環境変数
// OPENROUTESERVICE_API_KEY で管理する（NEXT_PUBLIC_ にはしない）。
//
// 出典・利用規約・エンドポイントの検証記録は data/README.md を参照。

import { NextResponse } from "next/server";

// 2026年時点の正式エンドポイント（api.heigit.org）。
// 古い api.openrouteservice.org は使用しない（ユーザーとの合意事項）。
const ORS_ENDPOINT_BASE = "https://api.heigit.org/openrouteservice/v2/directions";

type LatLng = { lat: number; lng: number };

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

export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTESERVICE_API_KEY;
  if (!apiKey) {
    // ビルドは壊さず、実行時にだけ分かるエラーとして返す（開発者向けメッセージ）。
    return NextResponse.json(
      { error: "ルーティングAPIが設定されていません（OPENROUTESERVICE_API_KEYが未設定です）" },
      { status: 500 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストの形式が不正です" }, { status: 400 });
  }

  const { origin, destination } = (body ?? {}) as { origin?: unknown; destination?: unknown };
  if (!isValidLatLng(origin) || !isValidLatLng(destination)) {
    return NextResponse.json(
      { error: "origin/destination（lat, lng）が必要です" },
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
  } catch {
    return NextResponse.json(
      { error: "ルーティングAPIへの接続に失敗しました（通信エラー）" },
      { status: 502 }
    );
  }

  if (!orsResponse.ok) {
    // openrouteservice側のエラー内容をそのまま握りつぶさず、状況が分かる形で返す
    const text = await orsResponse.text().catch(() => "");
    return NextResponse.json(
      { error: `ルーティングAPIがエラーを返しました（status: ${orsResponse.status}）`, detail: text.slice(0, 500) },
      { status: 502 }
    );
  }

  const geojson = await orsResponse.json();
  return NextResponse.json({ provider: "openrouteservice", geojson });
}
