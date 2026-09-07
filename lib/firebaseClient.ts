// 試作3 PART C: Firebase Cloud Messaging（クライアント側）。
//
// 【重要】ここで使うFirebase Web設定(apiKey等)は、Firebaseの仕様上
// 元々ブラウザに公開される値であり、絶対非公開の秘密情報ではない
// (要件定義書2 PART C-1)。一方、Admin SDK用のサービスアカウント資格情報
// (lib/firebaseAdmin.ts)はサーバー専用であり、このファイルには一切登場しない。

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getMessaging, getToken, isSupported, type Messaging } from "firebase/messaging";
import { isIosSafariNotStandalone } from "./platform";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function hasFirebaseConfig(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
}

let appInstance: FirebaseApp | null = null;
function getFirebaseApp(): FirebaseApp | null {
  if (!hasFirebaseConfig()) return null;
  if (!appInstance) {
    appInstance = getApps()[0] ?? initializeApp(firebaseConfig);
  }
  return appInstance;
}

// PART C-4: 通知登録状態の内部区分。
export type FcmRegistrationState =
  | "unsupported"
  | "not-installed"
  | "permission-default"
  | "permission-denied"
  | "registering"
  | "enabled"
  | "error";

export type FcmRegistrationResult =
  | { state: "enabled"; token: string }
  | { state: Exclude<FcmRegistrationState, "enabled">; message?: string };

/**
 * 通知を有効化する（ユーザーの明示的な操作をきっかけに呼び出すこと。
 * PART C-3: アプリ起動直後に自動で呼び出してはいけない）。
 */
export async function requestFcmToken(): Promise<FcmRegistrationResult> {
  if (typeof window === "undefined") {
    return { state: "error", message: "サーバー側では実行できません" };
  }

  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    return { state: "unsupported" };
  }

  // PART B-4: iOSはホーム画面に追加(standalone起動)していないとPush通知APIが
  // 使えない。「Safariで開けば必ず使える」という前提を置かない。
  if (isIosSafariNotStandalone()) {
    return { state: "not-installed", message: "ホーム画面に追加してから再度お試しください" };
  }

  if (!hasFirebaseConfig()) {
    return { state: "error", message: "通知機能がまだ設定されていません（開発者向け設定未完了）" };
  }

  const supported = await isSupported().catch(() => false);
  if (!supported) return { state: "unsupported" };

  if (Notification.permission === "denied") return { state: "permission-denied" };

  if (Notification.permission === "default") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return permission === "denied" ? { state: "permission-denied" } : { state: "permission-default" };
    }
  }

  const app = getFirebaseApp();
  if (!app) return { state: "error", message: "通知機能がまだ設定されていません" };

  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  if (!vapidKey) return { state: "error", message: "VAPIDキーが設定されていません" };

  try {
    // PART B-2: PWA用と同じService Worker(/sw.js, root scope)をそのまま使う。
    // FirebaseがデフォルトSW("firebase-messaging-sw.js")を別途自動登録しようと
    // して競合しないよう、serviceWorkerRegistrationで既存の登録を明示的に渡す。
    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    const messaging: Messaging = getMessaging(app);
    const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
    if (!token) return { state: "error", message: "トークンを取得できませんでした" };
    return { state: "enabled", token };
  } catch (err) {
    console.error("[requestFcmToken] 失敗しました", err);
    return { state: "error", message: err instanceof Error ? err.message : "不明なエラー" };
  }
}
