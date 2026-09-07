// 試作3 PART D・E: 通知対象地点の登録（作成）。
//
// 【重要】保存する情報は最低限にする(PART D-1・D-2)。
// GPS移動履歴は継続保存せず、ユーザーが明示的に登録した瞬間の
// 1地点のスナップショットのみを保存する。
// 高潮は試作2から研究対象外のため、enabledHazardsにも含めない。

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebaseAdmin";

// 試作3時点の研究対象。要件定義書2 §5・§35の「高潮を評価対象外とする方針」に合わせる。
const ALLOWED_HAZARDS = ["flood", "inundation"] as const;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストの形式が不正です" }, { status: 400 });
  }

  const { latitude, longitude, enabledHazards, fcmToken } = (body ?? {}) as {
    latitude?: unknown;
    longitude?: unknown;
    enabledHazards?: unknown;
    fcmToken?: unknown;
  };

  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return NextResponse.json({ error: "latitude/longitude（数値）が必要です" }, { status: 400 });
  }
  if (typeof fcmToken !== "string" || !fcmToken) {
    return NextResponse.json(
      { error: "fcmToken（通知トークン）が必要です。先に通知を有効化してください" },
      { status: 400 }
    );
  }

  const hazards = Array.isArray(enabledHazards)
    ? enabledHazards.filter((h): h is string => typeof h === "string" && (ALLOWED_HAZARDS as readonly string[]).includes(h))
    : [...ALLOWED_HAZARDS];

  try {
    const db = getAdminFirestore();
    const docRef = await db.collection("monitoringPoints").add({
      latitude,
      longitude,
      enabledHazards: hazards.length > 0 ? hazards : [...ALLOWED_HAZARDS],
      notificationEnabled: true,
      fcmToken,
      createdAt: FieldValue.serverTimestamp(),
      // 試作3 PART1-3: 重複通知防止・監視ジョブの技術検証用フィールド
      // （要件定義書2 PART G-3・1-3）。実際の通知はまだ送っていないため
      // すべてnullで初期化する。
      lastNotificationState: null,
      lastNotifiedAt: null,
      lastEvaluatedForecastTime: null,
      lastCheckedAt: null,
      decisionVersion: null,
    });
    return NextResponse.json({ monitoringPointId: docRef.id });
  } catch (err) {
    console.error("[monitoring-points POST] 登録に失敗しました", err);
    return NextResponse.json({ error: "登録に失敗しました" }, { status: 500 });
  }
}
