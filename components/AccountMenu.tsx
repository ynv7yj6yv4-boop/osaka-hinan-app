"use client";

// Phase 7: アカウントメニュー。地図の表示面積を狭めないよう、ヘッダー内の
// 小さなアイコンボタンだけを常時表示し、押したときだけ既存のModal（スマートフォン
// ではBottom Sheet表示）で登録メールアドレスとログアウトを出す。
// メールアドレスはClerkのユーザー情報から表示するだけで、アプリ側では保存しない。

import { useEffect, useState } from "react";
import { useClerk, useUser } from "@clerk/nextjs";
import { AUTH_LOADING_TIMEOUT_MS } from "@/lib/auth/authConfig";
import Modal from "./ui/Modal";
import Button from "./ui/Button";
import { AccountIcon } from "./ui/icons";

/**
 * variant:
 * - "header"（既定）: 縦向きのヘッダー内に、情報アイコンと同じ大きさで並べる
 * - "floating": 横向き（ヘッダー非表示）のとき、地図の上に単独で浮かせる丸いボタン
 */
export default function AccountMenu({ variant = "header" }: { variant?: "header" | "floating" }) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  // 通常は開いてから1秒未満で表示される。通信障害等でいつまでも読み込めない場合に
  // 「読み込み中」のままにしないよう、一定時間で「取得できませんでした」へ切り替える。
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  useEffect(() => {
    if (!open || user) return;
    const timer = setTimeout(() => setLoadTimedOut(true), AUTH_LOADING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [open, user]);
  const emailAddress = user?.primaryEmailAddress?.emailAddress;
  const emailText = emailAddress
    ? emailAddress
    : (isLoaded && !user) || loadTimedOut
      ? "アカウント情報を取得できませんでした"
      : "（読み込み中）";

  async function handleSignOut() {
    setSigningOut(true);
    setError(null);
    try {
      await signOut({ redirectUrl: "/sign-in" });
    } catch {
      setError("ログアウトできませんでした。通信環境をご確認のうえ、もう一度お試しください。");
      setSigningOut(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label="アカウントメニューを開く"
        className={
          variant === "floating"
            ? "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/95 text-[var(--color-text-secondary)] shadow-[var(--shadow-sm)]"
            : "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--color-text-secondary)]"
        }
      >
        <AccountIcon className={variant === "floating" ? "h-6 w-6" : "h-5 w-5"} />
      </button>
      {open && (
        <Modal title="アカウント" onClose={() => setOpen(false)}>
          <p className="text-xs text-[var(--color-text-muted)]">登録メールアドレス</p>
          <p className="mt-0.5 break-all text-base font-bold text-[var(--color-text-primary)]">
            {emailText}
          </p>
          <div role="alert" aria-live="assertive">
            {error && <p className="mt-3 text-sm text-[var(--color-danger)]">{error}</p>}
          </div>
          <Button variant="danger-outline" fullWidth className="mt-5" onClick={handleSignOut} disabled={signingOut}>
            {signingOut ? "ログアウトしています…" : "ログアウト"}
          </Button>
        </Modal>
      )}
    </>
  );
}
