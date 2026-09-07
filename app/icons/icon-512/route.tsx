import { ImageResponse } from "next/og";
import { renderAppIcon } from "@/lib/appIconArt";

// 試作3 PART B-1: Web App Manifestのicons配列から参照する、512x512の
// 固定URL(/icons/icon-512)。Android/Chromeのインストールプロンプト等で
// 使われる。中央にゆとりのあるデザインにしているため、"maskable"としても
// 同じ画像をそのまま利用する(app/manifest.ts参照)。
export async function GET() {
  return new ImageResponse(renderAppIcon(512), { width: 512, height: 512 });
}
