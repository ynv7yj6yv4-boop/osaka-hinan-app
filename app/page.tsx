"use client";

import dynamic from "next/dynamic";

// LeafletはブラウザAPI（window等）に依存するため、
// サーバー側では描画せず、クライアント側でのみ読み込む。
const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
});

export default function Home() {
  return <MapView />;
}
