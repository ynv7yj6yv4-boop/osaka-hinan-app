import type { Metadata, Viewport } from "next";
import { Noto_Sans_JP } from "next/font/google";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import DevNotificationTester from "@/components/DevNotificationTester";
import "./globals.css";

// デジタル庁デザインシステムの考え方(タイポグラフィ)を参考に、
// 日本語の可読性を優先してNoto Sans JPを採用する。
const notoSansJP = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "大阪市 避難支援マップ",
  description: "大阪市を対象とした災害避難支援Webアプリ",
  // 試作3 PART B-4: iOSの「ホーム画面に追加」時のタイトル表示に使われる。
  appleWebApp: {
    title: "避難支援マップ",
    // Safari標準のUI(URLバー等)を隠したstandalone表示にする。
    // ただしEU圏のiOSでは規制(DMA)によりPWAがSafariタブで開く場合がある
    // （detailはチャット記録・data/README.md参照。実機確認が必要）。
    statusBarStyle: "default",
    capable: true,
  },
};

// 試作3 PART B-1: manifest.tsのtheme_colorと合わせ、ブラウザのアドレスバー等の
// 色にも反映されるよう指定する。
export const viewport: Viewport = {
  themeColor: "#1d4ed8",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className={`${notoSansJP.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <ServiceWorkerRegister />
        {children}
        {/* 試作3 PART C-3・H: 開発者専用。NEXT_PUBLIC_ENABLE_DEV_TOOLS=1の
            場合のみ表示（一般ユーザーには表示されない）。 */}
        {process.env.NEXT_PUBLIC_ENABLE_DEV_TOOLS === "1" && <DevNotificationTester />}
      </body>
    </html>
  );
}
