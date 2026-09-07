// 試作3 PART C・H: Firebase Admin SDK（サーバー専用）。
//
// 【重要】このファイルはNext.jsのサーバー側コード（Route Handler等）からのみ
// importすること。クライアントコードには一切含めない。
// ここで使う秘密鍵(FIREBASE_ADMIN_PRIVATE_KEY)は、Git・README・console・
// ユーザー向けレスポンスのいずれにも出してはいけない(要件定義書2 §18と同じ方針)。

import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { getFirestore } from "firebase-admin/firestore";

let adminApp: App | null = null;

function getAdminApp(): App {
  if (adminApp) return adminApp;

  const existing = getApps();
  if (existing.length > 0) {
    adminApp = existing[0];
    return adminApp;
  }

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKeyRaw = process.env.FIREBASE_ADMIN_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKeyRaw) {
    throw new Error(
      "Firebase Admin SDKの環境変数(FIREBASE_ADMIN_PROJECT_ID / FIREBASE_ADMIN_CLIENT_EMAIL / FIREBASE_ADMIN_PRIVATE_KEY)が未設定です"
    );
  }

  // .env等では秘密鍵内の改行が文字列"\n"として保存されるため、実際の改行に戻す
  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");

  adminApp = initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
  return adminApp;
}

export function getAdminMessaging() {
  return getMessaging(getAdminApp());
}

// 試作3 PART D・E: 通知対象地点(monitoringPoints)の永続化に使用する。
export function getAdminFirestore() {
  return getFirestore(getAdminApp());
}
