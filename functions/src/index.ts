// 試作3 次段階 PART 1・要件定義書3「方式A」: Firebase Scheduled Functionsによる
// 監視地点の定期確認。
//
// 【重要・2026-09-09時点の運用状況】このCloud Functions版(onScheduleトリガー)は
// Firebaseプロジェクトが現在Sparkプラン(無料)であり、Cloud Functions(2nd gen)の
// デプロイにBlazeプラン(従量課金)が必須なため、**現時点ではデプロイしていない**。
// 人間側の判断で、Blazeへ課金するまでの間は、代わりに
// scripts/run-monitoring-check.mjs をGitHub Actions(無料のスケジュール実行)から
// 呼び出す運用にしている(.github/workflows/check-monitoring-points.yml参照)。
// このファイルは、将来Blazeへ課金した際にそのままデプロイできるよう、
// コードとしては維持している(判定ロジック自体はmonitoringCheck.tsに切り出し済み
// で、Cloud Functions版・スタンドアロン版の両方から共有している)。
//
// 【方式Aで解決したこと】
// 以前はlib/tilePixel.tsがブラウザのCanvas/Image APIに依存しており、Node.js
// 環境（Cloud Functions）で動作しなかったため、常に「確認できなかった」という
// ダミー入力を評価関数へ渡していた。tilePixelNode.ts（pngjsによるNode.js版
// PNGデコード）を実装したことで、実際のハザードタイル・降雨予測タイルを
// サーバー側で取得できるようになった。
//
// 【まだ実装していないこと・重要】
// - 実際の通知送信(FCM送信)コード自体はまだ書いていない。evaluateNotificationDecision()
//   が"candidate"を返しても、それを実際にFCMへ送る処理は別途必要。
// - notificationDecisionConfig.enabled は false のままなので、万一この後の
//   実装に誤りがあっても、実際の送信につながる"candidate"には到達しない
//   （多重防御。詳細はnotificationDecisionConfig.ts参照）。

import { onSchedule } from "firebase-functions/scheduler";
import { setGlobalOptions } from "firebase-functions/v2";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { runMonitoringCheck } from "./monitoringCheck";
import { notificationDecisionConfig } from "./notificationDecisionConfig";

initializeApp();
setGlobalOptions({ region: "asia-northeast1" });

// 【監視頻度について(要件定義書2 次段階 PART 1-2)】
// 5分・10分のどちらを本番採用するかはまだ決定していない。ここでは
// 「高解像度降水ナウキャスト(実況・予測)の更新間隔が5分」という事実に
// 合わせ、技術検証用に5分ごとに設定している。これは技術検証用の値であり、
// 最終的な監視頻度の決定ではない。
export const checkMonitoringPoints = onSchedule(
  {
    schedule: "every 5 minutes",
    timeoutSeconds: 60,
    retryCount: 0, // 5分後に次の実行が来るため、失敗時の自動リトライは行わない
  },
  async () => {
    const result = await runMonitoringCheck(getFirestore());
    console.log(
      `[checkMonitoringPoints] checked=${result.checked} candidateCount=${result.candidateCount} ` +
        `insufficientDataCount=${result.insufficientDataCount} enabled=${notificationDecisionConfig.enabled} ` +
        `decisionVersion=${notificationDecisionConfig.decisionVersion}`
    );
  }
);
