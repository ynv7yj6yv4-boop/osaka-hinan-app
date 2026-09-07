"use client";

import { useEffect } from "react";

// 試作3 PART B-2: Service Workerの登録。
// 開発中(next dev)はキャッシュが原因でコード変更が反映されない等の混乱を
// 避けるため登録しない。本番ビルド(next build && next start / Vercel)での
// み登録する。
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("[ServiceWorkerRegister] 登録に失敗しました", err);
    });
  }, []);

  return null;
}
