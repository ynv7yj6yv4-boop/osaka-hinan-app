// Phase 7: Clerk認証（Next.js 16ではmiddleware.tsではなくproxy.tsを使う）。
//
// 【方針】ここでは一括のアクセス制御を行わない。clerkMiddleware()は、各リソース
// （ページ・Route Handler）で `await auth()` を使えるようにするためだけに置く。
// 実際の保護は、データを読み書きする場所の近くで個別に行う（Clerk公式推奨の
// resource-based auth checks。createRouteMatcher()による一括保護は非推奨）:
// - app/page.tsx（地図）: 未ログインならサインイン画面へ
// - app/api/region・evacuation-route・monitoring-points: 未ログインなら401
// Cron・テスト通知（CRON_SECRET等のserver-to-server認証）、manifest・Service
// Worker・アイコン・公開データは、Clerkのセッションを要求しない（lib/auth/
// routeAccess.ts参照）。

import { clerkMiddleware } from "@clerk/nextjs/server";

export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
    // Always run for Clerk-specific frontend API routes
    "/__clerk/(.*)",
  ],
};
