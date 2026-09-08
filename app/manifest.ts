import type { MetadataRoute } from "next";

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
    name: "大阪市 避難支援マップ",
    short_name: "避難支援マップ",
    description:
      "大阪市を対象とした災害避難支援Webアプリ。現在地の洪水・内水氾濫ハザード情報や、洪水時の参考避難ルートを確認できます。",
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
