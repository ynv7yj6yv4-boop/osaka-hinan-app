// Phase 7: API Route・特殊ルートの認証要否の一覧（唯一の分類表）。
//
// 【方針】一括でauth.protect()をかけず、用途を確認したうえで個別に分類する。
// ここに無いRoute Handlerを追加した場合はテスト（routeAccess.test.ts）が失敗し、
// 分類漏れに気付けるようにしている。実際のチェックは各route.ts内で行う
// （lib/auth/requireApiAuth.ts）。

export type RouteAccess =
  /** ログイン中のアプリ利用者だけが使う。Clerkセッションが無ければ401。 */
  | "clerk_session_required"
  /** Clerkのセッションとは別の、サーバー間用の共有シークレットで保護（Cron等）。
   *  利用者のClerkセッションは要求しない。 */
  | "server_secret"
  /** 研究・開発用。本番（NODE_ENV=production）では各route内で403を返す。 */
  | "dev_only"
  /** PWA・アイコン等、未ログインでも取得できる必要がある公開リソース。 */
  | "public";

export type RouteAccessEntry = {
  route: string;
  access: RouteAccess;
  reason: string;
};

export const ROUTE_ACCESS: RouteAccessEntry[] = [
  {
    route: "/api/region",
    access: "clerk_session_required",
    reason: "地図画面（ログイン必須）から現在地を送って地域判定する。地図画面が表示された時点でセッションは確立済みのため、初期化順序の循環は起きない。",
  },
  {
    route: "/api/evacuation-route",
    access: "clerk_session_required",
    reason: "openrouteserviceの有料枠APIキーを使うため、ログイン利用者に限定して第三者による濫用を防ぐ。",
  },
  {
    route: "/api/monitoring-points",
    access: "clerk_session_required",
    reason: "通知対象地点（緯度経度・FCM token）の登録。既存のfcmToken所有確認に加えてログインを要求する（userIdとの紐付けは次Phase）。",
  },
  {
    route: "/api/monitoring-points/[id]",
    access: "clerk_session_required",
    reason: "通知対象地点の取得・削除・更新。同上。",
  },
  {
    route: "/api/cron/check-monitoring",
    access: "server_secret",
    reason: "定期監視ジョブ。CRON_SECRETのBearer認証で保護。利用者のセッションが無いという理由で止めない。",
  },
  {
    route: "/api/test-notification",
    access: "server_secret",
    reason: "開発者向けのテスト通知送信。TEST_NOTIFICATION_SECRETで保護。",
  },
  {
    route: "/api/dev/candidate-population",
    access: "dev_only",
    reason: "研究用。本番では403。",
  },
  {
    route: "/api/dev/candidate-population-classification",
    access: "dev_only",
    reason: "研究用。本番では403。",
  },
  {
    route: "/api/dev/research-monitoring-points",
    access: "dev_only",
    reason: "研究用。本番では403。",
  },
  {
    route: "/api/dev/static-flood-hazard-capture",
    access: "dev_only",
    reason: "研究用。本番では403。",
  },
  {
    route: "/sw.js",
    access: "public",
    reason: "Service Worker本体。未ログインでも登録・更新できる必要がある（PWAの起動・通知受信）。",
  },
  {
    route: "/icons/icon-192",
    access: "public",
    reason: "PWAアイコン（manifestから参照）。",
  },
  {
    route: "/icons/icon-512",
    access: "public",
    reason: "PWAアイコン（manifestから参照）。",
  },
];
