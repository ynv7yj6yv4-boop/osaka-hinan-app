// 要件定義書4後続: 開発者本人だけを対象とした自動通知パイプライン限定検証の
// CLIエントリポイント(方式C: ローカル/Preview環境から手動で1回だけ実行する)。
//
// 【重要】notificationDecisionConfig.enabled(本番シングルトン)は変更しない。
// このスクリプトでもenabled=falseのままFirestore初期化・認証を行い、
// devSimulationCheck.ts側の呼び出し引数としてのみローカルにenabled:trueを渡す。
//
// 実行方法: npm run check:dev-simulation (functions/package.json参照)
//
// 必要な環境変数:
// - FIREBASE_ADMIN_PROJECT_ID / FIREBASE_ADMIN_CLIENT_EMAIL / FIREBASE_ADMIN_PRIVATE_KEY
//   (runStandalone.tsと同じ既存のSecrets/値を流用。新規シークレット不要)
// - DEV_TEST_MONITORING_POINT_ID: 検証対象として明示的に許可する、
//   開発者自身のmonitoringPointsドキュメントID(使い捨てのテスト専用地点を想定)
// - DEV_TEST_MONITORING_POINT_ID_CONFIRM: 上記と完全に同じ値を再入力する
//   (コピー&ペーストミス・別地点への誤爆を防ぐための二重入力確認)
// - DEV_TEST_CONFIRM: 誤実行防止のための固定確認文字列。
//   "yes-send-one-notification"と完全一致しない限り送信しない。

import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { runDeveloperNotificationSimulation } from "./devSimulationCheck";

const REQUIRED_CONFIRM_VALUE = "yes-send-one-notification";

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
  // (lib/firebaseAdmin.ts・runStandalone.tsと同じ処理)。
  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");
  return { projectId, clientEmail, privateKey };
}

async function main() {
  const targetId = process.env.DEV_TEST_MONITORING_POINT_ID;
  const targetIdConfirm = process.env.DEV_TEST_MONITORING_POINT_ID_CONFIRM;
  const confirm = process.env.DEV_TEST_CONFIRM;

  if (!targetId) {
    throw new Error("DEV_TEST_MONITORING_POINT_IDが未設定です(誤実行防止のため、対象地点IDの明示指定が必須です)");
  }
  if (!targetIdConfirm || targetIdConfirm !== targetId) {
    throw new Error(
      "DEV_TEST_MONITORING_POINT_ID_CONFIRMがDEV_TEST_MONITORING_POINT_IDと一致しません" +
        "(コピー&ペーストミスによる誤った地点への送信を防ぐための二重入力確認です)"
    );
  }
  if (confirm !== REQUIRED_CONFIRM_VALUE) {
    throw new Error(
      `DEV_TEST_CONFIRMが一致しません。1件だけ送信する意図がある場合のみ、DEV_TEST_CONFIRM="${REQUIRED_CONFIRM_VALUE}" を設定してください`
    );
  }

  const { projectId, clientEmail, privateKey } = resolveCredentials();
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  const db = getFirestore();

  // 【重要】targetIdをallowlist(第3引数)としても渡す。ここまでの二重入力確認・
  // 固定確認文字列の両方を通過した値のみが、devSimulationCheck.ts内部の
  // 一致チェックにも渡される(コード側の多重防御)。
  const result = await runDeveloperNotificationSimulation(db, targetId, targetId);

  if (result.status === "completed") {
    console.log(
      `[runDevSimulation] status=completed decisionType=${result.decisionType} ` +
        `sendAttempted=${result.sendAttempted} sendResult=${result.sendResult} ` +
        `sendErrorCode=${result.sendErrorCode ?? "null"} autoDisabledPoint=${result.autoDisabledPoint}`
    );
  } else {
    console.log(`[runDevSimulation] status=${result.status}`);
  }
}

main().catch((err) => {
  console.error("[runDevSimulation] 失敗しました:", err);
  process.exit(1);
});
