"use client";

import { useState } from "react";
import { isIosSafariNotStandalone } from "@/lib/platform";

export default function IntroPanel({
  isLocating,
  onLocate,
}: {
  isLocating: boolean;
  onLocate: () => void;
}) {
  // 試作3 PART B-4: iOSでホーム画面に追加せずSafariで直接開いている場合、
  // 今後の通知機能等がホーム画面追加を前提とすることを事前に案内する
  // （「Safariで開けば必ず使える」という前提を置かない）。
  // このコンポーネントはssr:falseで動的importされるMapView経由でのみ
  // 描画されるため、初回レンダー時点でwindow/navigatorが利用可能。
  const [showIosHint] = useState(isIosSafariNotStandalone);

  return (
    <div className="mx-3 mt-3 rounded-xl border-2 border-blue-200 bg-blue-50 p-4">
      <h2 className="text-lg font-bold text-zinc-900">大阪市 災害避難支援</h2>
      <p className="mt-1 text-sm text-zinc-700">
        現在地のハザード情報から、避難の判断を支援します。
      </p>
      <button
        type="button"
        onClick={onLocate}
        disabled={isLocating}
        className="mt-3 w-full rounded-lg bg-blue-700 py-4 text-lg font-bold text-white active:bg-blue-800 disabled:opacity-60"
      >
        {isLocating ? "現在地を確認しています…" : "📍 現在地を取得して確認する"}
      </button>
      <p className="mt-2 text-xs text-zinc-600">
        ※本アプリは参考情報です。公式の避難情報は必ず自治体等の発表をご確認ください。
      </p>
      {showIosHint && (
        <p className="mt-2 rounded-lg bg-white/70 px-2 py-1.5 text-xs text-zinc-600">
          📱 iPhoneをお使いの場合、共有ボタン→「ホーム画面に追加」しておくと、今後追加予定の通知機能等がご利用いただけます。
        </p>
      )}
    </div>
  );
}
