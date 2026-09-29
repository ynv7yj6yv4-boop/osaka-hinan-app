"use client";

// Phase 7: 認証画面（新規登録・ログイン・パスワード再設定）の共通UI部品。
// 見た目は避難支援マップ本体（白系カード・青色CTA・角丸）に合わせる。
// 認証ロジックは一切持たない（すべて各フォームからClerkを呼ぶ）。

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth, useClerk } from "@clerk/nextjs";
import Button from "../ui/Button";
import Notice from "../ui/Notice";
import { APP_NAME, APP_TARGET_AREA_LABEL } from "@/lib/appInfo";
import { AUTH_LOADING_TIMEOUT_MS, EMAIL_LANGUAGE_NOTE, resendCooldownRemainingSeconds } from "@/lib/auth/authConfig";
import { NETWORK_ERROR_MESSAGE } from "@/lib/auth/authErrorMessages";

/** 認証画面の外枠。stepKeyが変わるたびに見出しへフォーカスを移す
 *  （スクリーンリーダー利用者が画面の切り替わりに気付けるようにするため）。 */
export function AuthShell({ title, stepKey, children }: { title: string; stepKey: string; children: ReactNode }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [stepKey]);

  return (
    <main className="flex min-h-dvh w-full justify-center bg-[var(--color-background)] px-4 py-8">
      <div className="w-full max-w-[420px]">
        <p className="text-center text-base font-bold text-[var(--color-text-primary)]">{APP_NAME}</p>
        <p className="mt-0.5 text-center text-xs text-[var(--color-text-muted)]">{APP_TARGET_AREA_LABEL}</p>
        <section className="mt-5 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-sm)]">
          <h1 ref={headingRef} tabIndex={-1} className="text-xl font-bold text-[var(--color-text-primary)] outline-none">
            {title}
          </h1>
          {children}
        </section>
      </div>
    </main>
  );
}

type Availability = "loading" | "ready" | "unavailable";

/** Clerkの読み込み（セッション確認）状態。一定時間たっても読み込めない場合や、
 *  Clerk自体の読み込みに失敗した場合は"unavailable"（通信障害の可能性）とする。 */
function useClerkAvailability(): Availability {
  const { isLoaded } = useAuth();
  const clerk = useClerk();
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (isLoaded) return;
    const timer = setTimeout(() => setTimedOut(true), AUTH_LOADING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isLoaded]);
  if (isLoaded) return "ready";
  if (clerk.status === "error" || timedOut) return "unavailable";
  return "loading";
}

/** Clerkの準備ができるまでフォームを出さない（入力途中で状態が切り替わる
 *  画面のちらつきを防ぐ）。通信障害時は「ログイン失敗」ではなく通信の確認を促す。 */
export function AuthReadyGate({ children }: { children: ReactNode }) {
  const availability = useClerkAvailability();
  if (availability === "ready") return <>{children}</>;
  if (availability === "unavailable") {
    return (
      <div className="mt-4">
        <Notice tone="warning" title="認証状態を確認できません">
          {NETWORK_ERROR_MESSAGE}
        </Notice>
        <Button onClick={() => window.location.reload()} fullWidth className="mt-3">
          再読み込み
        </Button>
      </div>
    );
  }
  return (
    <p className="mt-4 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]" role="status">
      <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
      読み込んでいます…
    </p>
  );
}

/** エラー表示（aria-liveで読み上げる）。messageがnullのときも要素自体は置いておく
 *  （後から追加されたliveリージョンは読み上げられないことがあるため）。 */
export function AuthError({ message, id }: { message: string | null; id: string }) {
  return (
    <div id={id} role="alert" aria-live="assertive" className="empty:hidden">
      {message && (
        <p className="mt-3 rounded-[var(--radius-sm)] border border-[var(--color-danger-border)] bg-[var(--color-danger-surface)] px-3 py-2 text-sm leading-relaxed text-[var(--color-danger)]">
          {message}
        </p>
      )}
    </div>
  );
}

/** 確認コード入力画面の補足（Clerkから英語のメールで届くこと・迷惑メールフォルダ）。 */
export function EmailCodeNote() {
  return (
    <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
      {EMAIL_LANGUAGE_NOTE}
      メールが届かない場合は、迷惑メールフォルダもご確認ください。
    </p>
  );
}

/** 補足メッセージ（コード再送完了等）。 */
export function AuthInfo({ message }: { message: string | null }) {
  return (
    <div role="status" aria-live="polite" className="empty:hidden">
      {message && <p className="mt-3 text-sm leading-relaxed text-[var(--color-success)]">{message}</p>}
    </div>
  );
}

const inputClass =
  "mt-1 block w-full rounded-[var(--radius-md)] border-2 border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2.5 text-base text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)]";

export function EmailField({
  value,
  onChange,
  describedBy,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  describedBy?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="mt-4">
      <label htmlFor="email" className="text-sm font-bold text-[var(--color-text-primary)]">
        メールアドレス
      </label>
      <input
        id="email"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        required
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={describedBy}
        className={inputClass}
      />
    </div>
  );
}

export function PasswordField({
  value,
  onChange,
  autoComplete,
  label = "パスワード",
  hint,
  describedBy,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  autoComplete: "new-password" | "current-password";
  label?: string;
  hint?: string;
  describedBy?: string;
  autoFocus?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const hintId = hint ? "password-hint" : undefined;
  return (
    <div className="mt-4">
      <label htmlFor="password" className="text-sm font-bold text-[var(--color-text-primary)]">
        {label}
      </label>
      <div className="relative">
        <input
          id="password"
          name="password"
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          required
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={[hintId, describedBy].filter(Boolean).join(" ") || undefined}
          className={`${inputClass} pr-16`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-controls="password"
          className="absolute right-1 top-1/2 min-h-11 -translate-y-1/2 px-2 text-sm font-bold text-[var(--color-primary)]"
        >
          {visible ? "隠す" : "表示"}
        </button>
      </div>
      {hint && (
        <p id={hintId} className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
          {hint}
        </p>
      )}
    </div>
  );
}

/** 確認コード入力。貼り付けやOSの自動入力（autocomplete="one-time-code"）が
 *  使いやすいよう、6分割ではなく1つの入力欄にしている。数字以外は取り除く。 */
export function CodeField({ value, onChange, describedBy }: { value: string; onChange: (v: string) => void; describedBy?: string }) {
  return (
    <div className="mt-4">
      <label htmlFor="code" className="text-sm font-bold text-[var(--color-text-primary)]">
        確認コード（6桁）
      </label>
      <input
        id="code"
        name="code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        required
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
        aria-describedby={describedBy}
        className={`${inputClass} text-center text-2xl font-bold tracking-[0.5em]`}
      />
    </div>
  );
}

/** 確認コードの再送ボタン。送信直後から一定時間は押せないようにする
 *  （連打による大量送信の防止。Clerk側の送信制限とは別の、控えめなUI側の制限）。 */
export function ResendCodeButton({ onResend, cooldownStartedAt }: { onResend: () => Promise<void>; cooldownStartedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  const [sending, setSending] = useState(false);
  const remaining = resendCooldownRemainingSeconds(cooldownStartedAt, now);
  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [remaining, cooldownStartedAt]);

  return (
    <Button
      variant="tertiary"
      fullWidth
      className="mt-2 shadow-none"
      disabled={remaining > 0 || sending}
      onClick={async () => {
        setSending(true);
        try {
          await onResend();
        } finally {
          setSending(false);
          setNow(Date.now());
        }
      }}
    >
      {sending ? "送信しています…" : remaining > 0 ? `確認コードを再送（${remaining}秒後に再送できます）` : "確認コードを再送"}
    </Button>
  );
}

export function SubmitButton({ busy, children, busyLabel }: { busy: boolean; children: ReactNode; busyLabel: string }) {
  return (
    <Button type="submit" fullWidth size="lg" disabled={busy} className="mt-5">
      {busy ? busyLabel : children}
    </Button>
  );
}
