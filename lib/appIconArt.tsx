// 試作3 PART B-1: PWAアイコン用の共通デザイン（app/icon.tsx・apple-icon.tsx・
// app/icons/icon-192・icon-512 から共通で利用する）。
//
// 【重要】next/ogのImageResponse(Satori)は、標準では絵文字・日本語フォントを
// 正しく描画できない（別途フォントデータの読み込みが必要）。フォント依存の
// 問題を避けるため、文字は使わず、単純な図形（丸いピン形状）のみで構成する。

import type { ReactElement } from "react";

export function renderAppIcon(sizePx: number): ReactElement {
  const pinSize = Math.round(sizePx * 0.42);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#1d4ed8",
        borderRadius: sizePx * 0.22,
      }}
    >
      {/* シンプルな「現在地ピン」を模した白い円（絵文字・文字を使わずフォント依存を避ける） */}
      <div
        style={{
          width: pinSize,
          height: pinSize,
          borderRadius: "50%",
          background: "#ffffff",
          display: "flex",
        }}
      />
    </div>
  );
}
