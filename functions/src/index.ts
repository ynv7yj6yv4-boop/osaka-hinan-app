// 試作3 次段階 PART 1: Firebase Scheduled Functionsによる監視地点の定期確認。
//
// 【重要・現時点のスコープ】この関数はまだ「実際の通知送信」までは行わない。
// 確認できているのは以下の配管のみ:
//   Cloud Scheduler → onSchedule実行 → Firestore読み取り → 評価関数呼び出し
//                   → Firestore書き込み（確認記録のみ）
//
// 実際の降雨予測・静的ハザード情報の取得はまだここでは行っていない。
// 理由: lib/tilePixel.ts（Next.jsアプリ側）はブラウザのCanvas/Image APIに
// 依存しており、Node.js環境（Cloud Functions）ではそのまま動作しない。
// PNG画像をNode.js上でデコードする実装（例: pngjsライブラリ等）が別途
// 必要であり、これは次のフェーズで対応する（このコメントは「動作するふりを
// しない」という開発方針に基づき、意図的に残している）。
//
// notificationDecisionConfig.enabled は false のままなので、
// 万一この後の実装でダミー値の扱いを間違えても、実際の送信(candidate)には
// 到達しない（多重防御。詳細はnotificationDecisionConfig.ts参照）。

import { onSchedule } from "firebase-functions/scheduler";
import { setGlobalOptions } from "firebase-functions/v2";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { evaluateNotificationDecision } from "./notificationDecision";
import { notificationDecisionConfig } from "./notificationDecisionConfig";

initializeApp();
setGlobalOptions({ region: "asia-northeast1" });

// 【監視頻度について(要件定義書2 次段階 PART 1-2)】
// 5分・10分のどちらを本番採用するかはまだ決定していない。ここでは
// 「高解像度降水ナウキャスト(実況・予測)の更新間隔が5分」という事実に
// 合わせ、技術検証用に5分ごとに設定している（=同じ予測データを取得しても
// 意味がないほど高頻度にはしていない、という考え方）。これは技術検証用の
// 値であり、最終的な監視頻度の決定ではない。
export const checkMonitoringPoints = onSchedule(
  {
    schedule: "every 5 minutes",
    timeoutSeconds: 60,
    retryCount: 0, // 5分後に次の実行が来るため、失敗時の自動リトライは行わない
  },
  async () => {
    const db = getFirestore();
    const snapshot = await db
      .collection("monitoringPoints")
      .where("notificationEnabled", "==", true)
      .get();

    const now = new Date();
    let candidateCount = 0;
    let insufficientDataCount = 0;

    // Firestoreの一括更新はバッチ1件あたり最大500件までのため、
    // 件数が少ない研究プロトタイプの現段階ではbatchで十分。
    const batch = db.batch();

    for (const doc of snapshot.docs) {
      const data = doc.data() as {
        lastNotificationState?: "sent" | "not_sent" | null;
        lastNotifiedAt?: string | null;
      };

      // 【未実装・重要】本来はdoc.data().latitude/longitudeから、
      // 実際のstaticFloodHazard（既存hazardPixelClassifier相当）・
      // rainfallForecast（lib/rainfallForecast.ts相当）をサーバー側で
      // 取得すべきだが、Node.js対応のタイル画像デコードが未実装のため、
      // 現時点では常に「確認できなかった」という安全な入力のみを渡す。
      const decision = evaluateNotificationDecision({
        staticFloodHazard: { status: "unknown", depthRank: 0 },
        rainfallForecast: { status: "unavailable", rank: null, leadTimeMinutes: null },
        dataCompleteness: "unavailable",
        previousNotificationState: {
          lastNotificationState: data.lastNotificationState ?? null,
          lastNotifiedAt: data.lastNotifiedAt ?? null,
        },
        now,
      });

      if (decision.type === "candidate") candidateCount++; // enabled:falseの間は理論上到達しない
      if (decision.type === "insufficient_data") insufficientDataCount++;

      // 実際の通知送信(FCM)は行わない。確認した事実とバージョンのみ記録する。
      batch.update(doc.ref, {
        lastCheckedAt: FieldValue.serverTimestamp(),
        decisionVersion: notificationDecisionConfig.decisionVersion,
        lastDecisionType: decision.type,
      });
    }

    if (snapshot.size > 0) await batch.commit();

    console.log(
      `[checkMonitoringPoints] checked=${snapshot.size} candidateCount=${candidateCount} insufficientDataCount=${insufficientDataCount} ` +
        `enabled=${notificationDecisionConfig.enabled} decisionVersion=${notificationDecisionConfig.decisionVersion}`
    );
  }
);
