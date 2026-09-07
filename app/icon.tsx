import { ImageResponse } from "next/og";
import { renderAppIcon } from "@/lib/appIconArt";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(renderAppIcon(32), { ...size });
}
