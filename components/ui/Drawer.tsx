"use client";

// 画面右端から開くサイドメニュー（ハンバーガーメニュー用）。ui/Modal.tsxと同じ方針
// （開いた瞬間に閉じるボタンへフォーカス・Escapeで閉じる・背景クリックで閉じる）に加え、
// 以下を行う。
// - Tab / Shift+Tab のフォーカスをドロワー内に閉じ込める（背面の地図へ移らない）
// - 閉じたら、開く前にフォーカスしていた要素（☰ボタン）へフォーカスを戻す
// - 背景は半透明の全面オーバーレイで覆い、背面の地図を誤操作しにくくする
//   （このアプリは画面全体がh-dvh・overflow-hiddenのため、bodyのスクロール固定は不要）
// - iPhoneのノッチ・ホームインジケーター（safe-area-inset）を避ける

import { useEffect, useRef, type ReactNode } from "react";
import { nextFocusIndex } from "@/lib/menu/appMenuState";
import { CloseIcon } from "./icons";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Drawer({
  title,
  titleId,
  leading,
  onClose,
  onBackdropClick,
  onEscape,
  children,
  focusKey,
}: {
  title: string;
  titleId: string;
  /** 戻るボタン等、見出し左側に追加のUIを差し込みたい場合に使う。 */
  leading?: ReactNode;
  onClose: () => void;
  onBackdropClick?: () => void;
  onEscape?: () => void;
  children: ReactNode;
  /** 画面（中身）が切り替わったときに、フォーカスを見出し側へ戻すためのキー。 */
  focusKey?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // 最新のハンドラーをrefに保持し、keydownリスナーを開いている間ずっと1つに保つ。
  const handlersRef = useRef({ onClose, onEscape });
  useEffect(() => {
    handlersRef.current = { onClose, onEscape };
  });

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        (handlersRef.current.onEscape ?? handlersRef.current.onClose)();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusables = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      const index = focusables.indexOf(document.activeElement as HTMLElement);
      const next = nextFocusIndex(index, focusables.length, e.shiftKey);
      if (next < 0) return;
      e.preventDefault();
      focusables[next].focus();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, [focusKey]);

  return (
    <div className="fixed inset-0 z-[1900] flex justify-end bg-black/40" onClick={onBackdropClick ?? onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex h-full w-[min(88vw,360px)] flex-col overflow-hidden bg-[var(--color-surface)] shadow-[var(--shadow-md)]"
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
          paddingRight: "env(safe-area-inset-right)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2">
          <div className="flex min-w-0 items-center gap-1">
            {leading}
            <h2 id={titleId} className="truncate pl-2 text-lg font-bold text-[var(--color-text-primary)]">
              {title}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="メニューを閉じる"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)]"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>
      </div>
    </div>
  );
}
