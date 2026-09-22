"use client";

// UI刷新: RiskDetailModal・EvacuationPanelで重複していたモーダルの外枠
// (モバイルはボトムシート、PC/タブレットは中央ダイアログ)を共通化する。
// 中身(見出し・本文・ボタン等)は各コンポーネント側でchildrenとして渡す。
//
// 【アクセシビリティ】開いた瞬間に閉じるボタンへフォーカスを移し、Escapeキーで
// 閉じられるようにする(これまで存在しなかった挙動の追加であり、既存の挙動を
// 壊すものではない)。

import { useEffect, useRef, type ReactNode } from "react";
import { CloseIcon } from "./icons";

export default function Modal({
  title,
  leading,
  onClose,
  children,
  labelledBy,
}: {
  /** ヘッダーに表示する見出し文字列。leadingを使う場合はundefinedでよい。 */
  title?: string;
  /** 戻るボタン等、見出し左側に追加のUIを差し込みたい場合に使う。 */
  leading?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  labelledBy?: string;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-end justify-center bg-black/40 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-[var(--radius-lg)] bg-[var(--color-surface)] shadow-[var(--shadow-md)] sm:max-w-md sm:rounded-[var(--radius-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--color-border)] px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-2">
            {leading}
            {title && (
              <h2 id={labelledBy} className="truncate text-lg font-bold text-[var(--color-text-primary)]">
                {title}
              </h2>
            )}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)]"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
