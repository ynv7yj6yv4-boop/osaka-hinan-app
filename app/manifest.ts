import type { MetadataRoute } from "next";
import { APP_NAME, APP_SHORT_NAME, APP_DESCRIPTION } from "@/lib/appInfo";

// 試作3 PART B-1: Web App Manifest。
// Next.js App Routerの規約により、このファイルは自動的に
// /manifest.webmanifest として配信され、<head>への<link>追加も
// Next.js側で自動的に行われる（layout.tsx側で手動リンク不要）。
//
// 【iPhone/Androidの違いについて】
// - iOSのホーム画面アイコンは、実際にはこのmanifestのiconsではなく
//   app/apple-icon.tsx（apple-touch-icon）が優先して使われる。
// - display: "standalone" はAndroid Chromeでは全画面風のアプリ表示に
//   なるが、iOS Safariの通常ブラウズには影響しない
//   （iOSでのstandalone表示は「ホーム画面に追加」した場合のみ有効）。
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    // Phase 6 PART C: 近畿2府4県対応版の名称へ変更（lib/appInfo.tsで一元管理）。
    name: APP_NAME,
    short_name: APP_SHORT_NAME,
    description: APP_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1d4ed8",
    lang: "ja",
    icons: [
      { src: "/icons/icon-192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
