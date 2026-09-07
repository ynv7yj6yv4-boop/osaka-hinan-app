import { ImageResponse } from "next/og";
import { renderAppIcon } from "@/lib/appIconArt";

// 試作3 PART B-1: Web App Manifestのicons配列から参照する、192x192の
// 固定URL(/icons/icon-192)。app/icon.tsx(ブラウザタブ用)とはサイズ・
// 用途が異なるため別ルートとして用意している(URLを安定させるため)。
export async function GET() {
  return new ImageResponse(renderAppIcon(192), { width: 192, height: 192 });
}
