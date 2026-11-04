"use client";

// Phase 7: アカウント情報（登録メールアドレス）とログアウト。
// 以前はヘッダーの単独アイコンからModalで開いていたが、ハンバーガーメニュー
// （components/AppMenu.tsx）の「アカウント」画面の中に組み込む形に変更した。
// Clerkのユーザー情報を扱う部分はこのファイルだけに閉じ込め、端末内の保存を
// 一切行わない（lib/auth/routeAccess.test.tsがこのファイルを検査している）。
// メールアドレスはClerkのユーザー情報から表示するだけで、アプリ側では保存しない。

import { useEffect, useState, type ReactNode } from "react";
import { useClerk, useUser } from "@clerk/nextjs";
import { AUTH_LOADING_TIMEOUT_MS } from "@/lib/auth/authConfig";
import Button from "./ui/Button";

export function AccountInfoItem({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="py-2.5">
      <dt className="text-xs text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-0.5 break-all text-base font-bold text-[var(--color-text-primary)]">{value}</dd>
      {note && <dd className="mt-0.5 text-xs leading-snug text-[var(--color-text-muted)]">{note}</dd>}
    </div>
  );
}

/** ログイン情報の表示とログアウトボタン。childrenはその間に表示する（端末の利用状況等）。 */
export default function AccountDetails({ children }: { children?: ReactNode }) {
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  // 通常は開いてから1秒未満で表示される。通信障害等でいつまでも読み込めない場合に
  // 「読み込み中」のままにしないよう、一定時間で「取得できませんでした」へ切り替える。
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  useEffect(() => {
    if (user) return;
    const timer = setTimeout(() => setLoadTimedOut(true), AUTH_LOADING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [user]);
  const notAvailable = (isLoaded && !user) || loadTimedOut;
  const emailAddress = user?.primaryEmailAddress?.emailAddress;
  const emailText = emailAddress
    ? emailAddress
    : notAvailable
      ? "アカウント情報を取得できませんでした"
      : "（読み込み中）";
  const loginStateText = user ? "ログイン中（メールアドレス）" : notAvailable ? "確認できませんでした" : "（読み込み中）";

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
      <section>
        <h3 className="text-sm font-bold text-[var(--color-text-secondary)]">ログイン情報</h3>
        <dl className="divide-y divide-[var(--color-border)]">
          <AccountInfoItem label="ログイン状態" value={loginStateText} />
          <AccountInfoItem label="登録メールアドレス" value={emailText} />
        </dl>
      </section>
      {children}
      <div role="alert" aria-live="assertive">
        {error && <p className="mt-3 text-sm text-[var(--color-danger)]">{error}</p>}
      </div>
      <Button variant="danger-outline" fullWidth className="mt-5" onClick={handleSignOut} disabled={signingOut}>
        {signingOut ? "ログアウトしています…" : "ログアウト"}
      </Button>
    </>
  );
}
