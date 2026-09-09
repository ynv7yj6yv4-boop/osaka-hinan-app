// 要件定義書3: Cloud Functions(Blazeプラン必須)を使わず、GitHub Actionsの
// スケジュール実行から呼び出すためのスタンドアロン版エントリポイント。
//
// 【重要】判定ロジックはmonitoringCheck.tsを共有しており、Cloud Functions版
// (index.ts)と完全に同じ処理を行う。Cloud Functions実行環境では認証情報が
// 自動的に注入されるが、ここではそれが無いため、環境変数
// (FIREBASE_ADMIN_PROJECT_ID / FIREBASE_ADMIN_CLIENT_EMAIL /
// FIREBASE_ADMIN_PRIVATE_KEY。Next.jsアプリのlib/firebaseAdmin.tsと同じ形)
// から明示的にサービスアカウント認証情報を組み立てる。
//
// 実行方法: npm run check:standalone (functions/package.json参照)
// GitHub Actionsからの呼び出し方は .github/workflows/check-monitoring-points.yml 参照。

import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { runMonitoringCheck } from "./monitoringCheck";
import { notificationDecisionConfig } from "./notificationDecisionConfig";

function resolveCredentials() {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKeyRaw = process.env.FIREBASE_ADMIN_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKeyRaw) {
    throw new Error(
      "Firebase Admin SDKの環境変数(FIREBASE_ADMIN_PROJECT_ID / FIREBASE_ADMIN_CLIENT_EMAIL / FIREBASE_ADMIN_PRIVATE_KEY)が未設定です"
    );
  }

  // GitHub Secrets等では秘密鍵内の改行が文字列"\n"として保存されるため、実際の改行に戻す
  // (lib/firebaseAdmin.tsと同じ処理)。
  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");
  return { projectId, clientEmail, privateKey };
}

async function main() {
  const { projectId, clientEmail, privateKey } = resolveCredentials();
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });

  const db = getFirestore();
  const result = await runMonitoringCheck(db);

  console.log(
    `[runStandalone] checked=${result.checked} candidateCount=${result.candidateCount} ` +
      `insufficientDataCount=${result.insufficientDataCount} enabled=${notificationDecisionConfig.enabled} ` +
      `decisionVersion=${notificationDecisionConfig.decisionVersion}`
  );
}

main().catch((err) => {
  console.error("[runStandalone] 失敗しました:", err);
  process.exit(1);
});
