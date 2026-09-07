// 試作3 PART B-2・C: Service Worker本体を動的ルートとして生成する。
//
// 【なぜ静的ファイル(public/sw.js)から変更したか】
// Firebase Cloud Messagingのバックグラウンド受信には、Service Worker内で
// firebase.initializeApp(config)を呼ぶ必要がある。このconfigはFirebase仕様上
// 元々クライアントに公開される値だが(要件定義書2 PART C-1)、静的ファイルは
// Next.jsのビルド時環境変数を読めないため、値を埋め込めない。
// そのため、このルート(/sw.js)がリクエスト時にNEXT_PUBLIC_の値を読み、
// スクリプトを生成して返す方式にした。
//
// 【重要】ここで埋め込むのはNEXT_PUBLIC_で始まる公開用の値のみ。
// サーバー専用の秘密情報(FIREBASE_ADMIN_*)は絶対にここに含めない。
//
// 【PWA用とFCM用のSWを1つに統合する理由】(要件定義書2 PART B-2)
// PWA用Service WorkerとFCM用Service Workerをroot scopeで別々に登録すると
// 競合するため、最初からこの1ファイルに両方の役割(オフラインキャッシュ＋
// FCMバックグラウンド受信)を統合している。

import { NextResponse } from "next/server";

const FIREBASE_JS_SDK_VERSION = "12.18.0";

export async function GET() {
  const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
  };
  const hasFirebaseConfig = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

  const cachingLogic = `
// ---- オフライン時の簡易キャッシュ(既存機能。PART B-3参照) ----
const CACHE_NAME = "osaka-hinan-app-v1";
const NEVER_CACHE_PREFIXES = ["/api/"];

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function shouldSkipCache(url) {
  if (url.origin !== self.location.origin) return true;
  return NEVER_CACHE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (shouldSkipCache(url)) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response && response.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
      }
      return response;
    } catch {
      const cached = await caches.match(request);
      if (cached) return cached;
      throw new Error("network error and no cache available");
    }
  })());
});
`;

  const fcmLogic = hasFirebaseConfig
    ? `
// ---- Firebase Cloud Messaging バックグラウンド受信 ----
importScripts("https://www.gstatic.com/firebasejs/${FIREBASE_JS_SDK_VERSION}/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/${FIREBASE_JS_SDK_VERSION}/firebase-messaging-compat.js");

firebase.initializeApp(${JSON.stringify(firebaseConfig)});
const messaging = firebase.messaging();

// PART F-4: 初期通知は「避難命令」ではなく「リスク上昇の可能性」程度の
// 表現にとどめる方針(実際の通知判定ルールはStep10で人間の確認後に有効化)。
messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || "大阪市 避難支援マップ";
  const body = (payload.notification && payload.notification.body) || "";
  self.registration.showNotification(title, {
    body,
    icon: "/icons/icon-192",
    data: payload.data || {},
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // PART F-5: 通知タップでアプリを開き、対象地点の情報を確認できるようにする
  event.waitUntil(clients.openWindow("/"));
});
`
    : `
// NEXT_PUBLIC_FIREBASE_* が未設定のため、FCMバックグラウンド受信は無効です
// (オフラインキャッシュ機能のみ有効)。
`;

  const script = `// 自動生成されたService Workerです(app/sw.js/route.ts)。直接編集しないでください。
${cachingLogic}
${fcmLogic}
`.trim();

  return new NextResponse(script, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // Service Workerは常に最新のものをブラウザに確認させたいため積極的にキャッシュしない
      "Cache-Control": "no-cache",
      "Service-Worker-Allowed": "/",
    },
  });
}
