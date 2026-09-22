"use client";

import { useState } from "react";
import { isIosSafariNotStandalone } from "@/lib/platform";
import Button from "./ui/Button";
import { LocationIcon } from "./ui/icons";

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
    <div className="mt-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-sm)]">
      <h2 className="text-lg font-bold text-[var(--color-text-primary)]">大阪市 災害避難支援</h2>
      <p className="mt-1 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        現在地のハザード情報から、避難の判断を支援します。
      </p>
      <Button onClick={onLocate} disabled={isLocating} fullWidth size="lg" className="mt-3">
        <LocationIcon className="h-5 w-5 shrink-0" />
        {isLocating ? "現在地を確認しています…" : "現在地を取得して確認する"}
      </Button>
      <p className="mt-2 text-xs leading-relaxed text-[var(--color-text-muted)]">
        ※本アプリは参考情報です。公式の避難情報は必ず自治体等の発表をご確認ください。
      </p>
      {showIosHint && (
        <p className="mt-2 rounded-[var(--radius-sm)] bg-[var(--color-surface-subtle)] px-2.5 py-2 text-xs leading-relaxed text-[var(--color-text-secondary)]">
          iPhoneをお使いの場合、共有ボタンから「ホーム画面に追加」しておくと、今後追加予定の通知機能等がご利用いただけます。
        </p>
      )}
    </div>
  );
}
