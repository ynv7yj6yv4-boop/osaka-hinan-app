// 試作3 PART D: 通知対象地点の取得・削除・有効/無効切り替え。
//
// 【重要】このアプリにはユーザーアカウント(ログイン)の仕組みがない。
// そのため、削除・更新の際は「登録時に使ったfcmTokenと一致するか」を
// 簡易的な所有確認として使う(研究用プロトタイプとしての現実的な範囲の対策。
// 強固な認証ではないことを明記しておく)。

import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebaseAdmin";

type MonitoringPointDoc = {
  latitude: number;
  longitude: number;
  enabledHazards: string[];
  notificationEnabled: boolean;
  fcmToken: string;
  // 試作3 PART1-3: 重複通知防止・監視ジョブ技術検証用フィールド
  lastNotificationState: string | null;
  lastNotifiedAt: string | null;
  lastEvaluatedForecastTime: string | null;
  lastCheckedAt: unknown;
  decisionVersion: string | null;
};

async function verifyOwnership(
  id: string,
  providedToken: unknown
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (typeof providedToken !== "string" || !providedToken) {
    return { ok: false, status: 400, error: "fcmTokenが必要です" };
  }
  const db = getAdminFirestore();
  const snap = await db.collection("monitoringPoints").doc(id).get();
  if (!snap.exists) return { ok: false, status: 404, error: "監視地点が見つかりません" };
  const data = snap.data() as MonitoringPointDoc;
  if (data.fcmToken !== providedToken) {
    return { ok: false, status: 403, error: "この監視地点を操作する権限がありません" };
  }
  return { ok: true };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const db = getAdminFirestore();
    const snap = await db.collection("monitoringPoints").doc(id).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "監視地点が見つかりません" }, { status: 404 });
    }
    const data = snap.data() as MonitoringPointDoc;
    // fcmTokenはレスポンスに含めない(ユーザー向けレスポンスへ秘密情報同等の
    // 識別子を不用意に返さない)。
    return NextResponse.json({
      monitoringPointId: id,
      latitude: data.latitude,
      longitude: data.longitude,
      enabledHazards: data.enabledHazards,
      notificationEnabled: data.notificationEnabled,
      lastNotificationState: data.lastNotificationState ?? null,
      lastNotifiedAt: data.lastNotifiedAt ?? null,
      lastEvaluatedForecastTime: data.lastEvaluatedForecastTime ?? null,
      decisionVersion: data.decisionVersion ?? null,
    });
  } catch (err) {
    console.error("[monitoring-points/:id GET] 失敗しました", err);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const { fcmToken } = (body ?? {}) as { fcmToken?: unknown };

  const check = await verifyOwnership(id, fcmToken);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  try {
    const db = getAdminFirestore();
    await db.collection("monitoringPoints").doc(id).delete();
    return NextResponse.json({ status: "deleted" });
  } catch (err) {
    console.error("[monitoring-points/:id DELETE] 失敗しました", err);
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストの形式が不正です" }, { status: 400 });
  }
  const { fcmToken, notificationEnabled } = (body ?? {}) as {
    fcmToken?: unknown;
    notificationEnabled?: unknown;
  };

  const check = await verifyOwnership(id, fcmToken);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  if (typeof notificationEnabled !== "boolean") {
    return NextResponse.json({ error: "notificationEnabled(true/false)が必要です" }, { status: 400 });
  }

  try {
    const db = getAdminFirestore();
    await db.collection("monitoringPoints").doc(id).update({ notificationEnabled });
    return NextResponse.json({ status: "updated" });
  } catch (err) {
    console.error("[monitoring-points/:id PATCH] 失敗しました", err);
    return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
  }
}
