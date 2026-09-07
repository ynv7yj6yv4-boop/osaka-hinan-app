// 試作3 PART G: 監視ジョブの技術検証（プラミングの確認のみ）。
//
// 【重要・PART F-3との関係】実際の通知判定ルール（どの条件で「リスク上昇」
// と判断し通知するか）は、まだ人間の確認を経ていない。そのため、この
// エンドポイントは監視地点をFirestoreから読み取り・書き込みできることだけを
// 確認し、通知は一切送信しない（notificationsSentは常に0）。
//
// 【セキュリティ】PART G-2: 環境変数CRON_SECRETと一致する
// "Authorization: Bearer <値>" ヘッダーが無い場合は拒否する。
// Vercel Cron Jobsは、vercel.jsonで設定したジョブを実行する際、
// 自動的にこのヘッダーを付けてリクエストする(値はCRON_SECRET環境変数と同じ)。

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebaseAdmin";

// 将来、実際の通知判定ロジックを有効化する際にバージョンを更新する
// (要件定義書2 PART K: decisionVersionとしてログに残す)。
export const DECISION_VERSION = "not-yet-enabled-v0";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRETが未設定です" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "認証に失敗しました" }, { status: 401 });
  }

  try {
    const db = getAdminFirestore();
    const snapshot = await db
      .collection("monitoringPoints")
      .where("notificationEnabled", "==", true)
      .get();

    // PART G-3: 重複通知防止の土台となる記録項目。
    // 今回はまだ通知を送らないため、lastNotifiedAt等は更新しない
    // （「確認した」という事実(lastCheckedAt)とdecisionVersionのみ記録する）。
    if (snapshot.size > 0) {
      const batch = db.batch();
      snapshot.docs.forEach((doc) => {
        batch.update(doc.ref, {
          lastCheckedAt: FieldValue.serverTimestamp(),
          decisionVersion: DECISION_VERSION,
        });
      });
      await batch.commit();
    }

    return NextResponse.json({
      status: "checked",
      monitoringPointCount: snapshot.size,
      notificationsSent: 0,
      note: "通知判定ルールは未実装のため、通知は送信していません（要件定義書2 PART F-3参照）",
    });
  } catch (err) {
    console.error("[cron/check-monitoring] 失敗しました", err);
    return NextResponse.json({ error: "チェックに失敗しました" }, { status: 500 });
  }
}
