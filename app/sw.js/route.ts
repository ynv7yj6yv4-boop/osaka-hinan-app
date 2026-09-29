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
import { APP_NAME } from "@/lib/appInfo";

const FIREBASE_JS_SDK_VERSION = "12.18.0";

// Phase 7: オフライン時にページを開いた場合の案内（Service Workerが返す）。
// 外部リソースに依存しない最小限のHTML。
const OFFLINE_PAGE_HTML = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${APP_NAME}</title><style>body{margin:0;font-family:system-ui,sans-serif;background:#f7f8fa;color:#1a1d21;display:flex;justify-content:center;padding:32px 16px}main{max-width:420px;width:100%;background:#fff;border:1px solid #d9dde3;border-radius:16px;padding:20px}h1{font-size:20px;margin:0 0 8px}p{font-size:15px;line-height:1.7;color:#4a5058}button{margin-top:16px;width:100%;min-height:48px;border:0;border-radius:12px;background:#1d4ed8;color:#fff;font-size:16px;font-weight:700}</style></head><body><main><p style="margin:0;font-weight:700;color:#1a1d21">${APP_NAME}</p><h1>認証状態を確認できません</h1><p>インターネットに接続できないため、ログイン状態を確認できません。通信環境をご確認のうえ、再読み込みしてください。</p><p>災害時は、自治体・気象庁等の公式情報や防災行政無線もあわせてご確認ください。</p><button onclick="location.reload()">再読み込み</button></main></body></html>`;

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
// Phase 7: v1→v2。認証導入前にキャッシュされたページ(HTML)を破棄するため。
const CACHE_NAME = "osaka-hinan-app-v2";
const NEVER_CACHE_PREFIXES = ["/api/"];

// Phase 7: ページ遷移（HTML）はキャッシュしない。サーバーが埋め込むClerkの
// 認証状態を端末内に残さないため、またログアウト後に以前の画面を表示しないため。
// 通信できない場合は、ログイン失敗ではなく通信障害であることが分かる画面を返す。
const OFFLINE_HTML = ${JSON.stringify(OFFLINE_PAGE_HTML)};

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

function shouldSkipCache(url, request) {
  if (url.origin !== self.location.origin) return true;
  // Phase 7: Next.jsのクライアント遷移用のサーバーコンポーネント応答（RSC）も
  // ページと同様に認証状態を含みうるため、キャッシュしない。
  if (url.searchParams.has("_rsc") || request.headers.get("RSC") === "1") return true;
  return NEVER_CACHE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (shouldSkipCache(url, request)) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        return new Response(OFFLINE_HTML, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
    })());
    return;
  }

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
  const title = (payload.notification && payload.notification.title) || ${JSON.stringify(APP_NAME)};
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
