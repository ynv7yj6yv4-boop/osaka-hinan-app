// 試作3 PART B-2・B-3: 自作のService Worker（外部ライブラリ不使用）。
//
// 【next-pwa等を使わなかった理由】
// next-pwaは2023年8月にアーカイブされ、現在メンテナンスされていない。
// 後継のnext-pwa forkやServist等も存在するが、いずれもビルド時に
// 静的アセットの一覧(プリキャッシュ・マニフェスト)をビルドツールへ
// 注入する仕組みが必要で、Next.js 16のTurbopack環境での動作・保守性を
// 確認できていない。そのため試作3では、ビルドツール非依存の
// 「ランタイムキャッシュ（アクセスした分だけキャッシュする）」という
// 単純な方式を採用した。ハッシュ付きのビルド成果物ファイル名を
// 事前に列挙する必要がなく、デプロイのたびに壊れる心配がない。
//
// 【このSWでキャッシュしないもの】
// - /api/ 配下（避難ルート取得等）: 常に最新のopenrouteservice応答が必要
// - 国土地理院・気象庁・ハザードマップポータルサイト等の外部タイル/データ:
//   災害情報は鮮度が重要なため、意図的にキャッシュ対象から除外する
//   （オフライン時に古いハザード情報を「最新」であるかのように表示しない）
//
// 【将来のFirebase Cloud Messaging統合について】
// PWA用とFCM用のService Workerをroot scopeで別々に登録すると競合するため
// (要件定義書2 PART B-2)、最初からこの1つのSWをroot scope("/")に統合する
// 設計にしている。Firebase導入時は、このファイルの末尾に
// importScripts('https://www.gstatic.com/firebasejs/.../firebase-messaging-compat.js')
// を追加し、firebase.initializeApp(...)・onBackgroundMessage(...)を
// ここに追記する（新しいSWファイルは作らない）。

const CACHE_NAME = "osaka-hinan-app-v1";

// 明示的にキャッシュ対象外とするパスの接頭辞
const NEVER_CACHE_PREFIXES = ["/api/"];

self.addEventListener("install", () => {
  // 新しいSWをすぐ有効化できるようにする（古いタブが残っていても更新を反映しやすくする）
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // 古いバージョンのキャッシュを削除する
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

function shouldSkipCache(url) {
  if (url.origin !== self.location.origin) return true; // 外部ドメイン(タイル等)は対象外
  return NEVER_CACHE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (shouldSkipCache(url)) return; // 何もせず通常のネットワーク取得に任せる

  // ネットワーク優先・失敗時のみキャッシュを使う方式
  // （災害情報アプリとして、オンライン時は常に最新を優先し、
  //   オフライン時のみ「無いよりはまし」の参考として直前の表示を出す）。
  event.respondWith(
    (async () => {
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
    })()
  );
});
