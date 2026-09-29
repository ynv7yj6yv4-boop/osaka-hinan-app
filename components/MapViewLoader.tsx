"use client";

import dynamic from "next/dynamic";

// LeafletはブラウザAPI（window等）に依存するため、
// サーバー側では描画せず、クライアント側でのみ読み込む。
// （Phase 7: app/page.tsxをサーバー側で認証チェックするServer Componentにしたため、
// ssr:falseのdynamic importはこのClient Componentへ移した。）
const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
});

export default function MapViewLoader() {
  return <MapView />;
}
