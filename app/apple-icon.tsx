import { ImageResponse } from "next/og";
import { renderAppIcon } from "@/lib/appIconArt";

// iOSの「ホーム画面に追加」時に使われるアイコン(apple-touch-icon)。
// Appleは180x180を推奨している。
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(renderAppIcon(180), { ...size });
}
