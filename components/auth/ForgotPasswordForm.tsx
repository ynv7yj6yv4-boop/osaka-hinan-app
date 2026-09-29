"use client";

// Phase 7: パスワード再設定（Clerk公式のforgot password custom flow。
// @clerk/nextjs v7のSignInFuture API）:
//   1. signIn.create({ identifier }) → signIn.resetPasswordEmailCode.sendCode()
//      でClerkが再設定コードをメール送信
//   2. signIn.resetPasswordEmailCode.verifyCode({ code })
//      → status が "needs_new_password" になる
//   3. signIn.resetPasswordEmailCode.submitPassword({ password, signOutOfOtherSessions })
//      → status === "complete" なら finalize() でログインしてマップへ
// 再設定用のトークン・コードはすべてClerkが発行・検証し、このアプリは保存しない。

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useSignIn } from "@clerk/nextjs";
import {
  AuthError,
  AuthInfo,
  AuthReadyGate,
  AuthShell,
  CodeField,
  EmailCodeNote,
  EmailField,
  PasswordField,
  ResendCodeButton,
  SubmitButton,
} from "./AuthUi";
import { createFinalizeNavigate, SESSION_TASK_MESSAGE } from "./finishAuth";
import { toAuthErrorMessage } from "@/lib/auth/authErrorMessages";

/** passwordRequirementText: Clerkに設定された実際のパスワード条件から組み立てた案内文
 *  （サーバー側でlib/auth/passwordPolicy.tsが取得してページから渡す）。 */
export default function ForgotPasswordForm({ passwordRequirementText }: { passwordRequirementText: string }) {
  const { signIn, fetchStatus } = useSignIn();
  const [emailAddress, setEmailAddress] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cooldownStartedAt, setCooldownStartedAt] = useState(0);
  const busy = fetchStatus === "fetching";

  async function sendResetCode(): Promise<boolean> {
    const { error: sendError } = await signIn.resetPasswordEmailCode.sendCode();
    setCooldownStartedAt(Date.now());
    if (sendError) {
      setError(toAuthErrorMessage(sendError, "reset_password"));
      return false;
    }
    setCodeSent(true);
    return true;
  }

  async function handleSendCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const { error: createError } = await signIn.create({ identifier: emailAddress.trim() });
    if (createError) {
      setError(toAuthErrorMessage(createError, "reset_password"));
      return;
    }
    await sendResetCode();
  }

  async function handleVerifyCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const { error: verifyError } = await signIn.resetPasswordEmailCode.verifyCode({ code });
    if (verifyError) setError(toAuthErrorMessage(verifyError, "verify_code"));
  }

  async function handleSubmitPassword(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const { error: submitError } = await signIn.resetPasswordEmailCode.submitPassword({
      password,
      // 他の端末に残っているセッションはすべてログアウトさせる（パスワード漏えい時の対策）。
      signOutOfOtherSessions: true,
    });
    if (submitError) {
      setError(toAuthErrorMessage(submitError, "sign_up"));
      return;
    }
    if (signIn.status !== "complete") {
      setError("パスワードは変更されましたが、ログインを完了できませんでした。ログイン画面からログインしてください。");
      return;
    }
    const { error: finalizeError } = await signIn.finalize({
      navigate: createFinalizeNavigate(() => setError(SESSION_TASK_MESSAGE)),
    });
    if (finalizeError) setError(toAuthErrorMessage(finalizeError, "sign_in"));
  }

  if (signIn.status === "needs_new_password") {
    return (
      <AuthShell title="新しいパスワードを設定" stepKey="new-password">
        <form onSubmit={handleSubmitPassword} noValidate>
          <PasswordField
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            label="新しいパスワード"
            hint={passwordRequirementText}
            describedBy="reset-error"
            autoFocus
          />
          <AuthError id="reset-error" message={error} />
          <SubmitButton busy={busy} busyLabel="設定しています…">
            パスワードを変更してログイン
          </SubmitButton>
        </form>
        <p className="mt-2 text-xs leading-relaxed text-[var(--color-text-muted)]">
          変更すると、ほかの端末ではログアウトされます。
        </p>
      </AuthShell>
    );
  }

  if (codeSent) {
    return (
      <AuthShell title="再設定コードを入力" stepKey="code">
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
          <span className="break-all font-bold text-[var(--color-text-primary)]">{emailAddress.trim()}</span>
          {" "}に再設定コードを送信しました。
        </p>
        <EmailCodeNote />
        <form onSubmit={handleVerifyCode} noValidate>
          <CodeField value={code} onChange={setCode} describedBy="reset-error" />
          <AuthError id="reset-error" message={error} />
          <AuthInfo message={info} />
          <SubmitButton busy={busy} busyLabel="確認しています…">
            確認する
          </SubmitButton>
        </form>
        <ResendCodeButton
          cooldownStartedAt={cooldownStartedAt}
          onResend={async () => {
            setError(null);
            setInfo(null);
            if (await sendResetCode()) setInfo("再設定コードを再送しました。メールをご確認ください。");
          }}
        />
        <p className="mt-3 text-center">
          <Link href="/sign-in" className="inline-block min-h-11 py-2 text-sm text-[var(--color-text-secondary)] underline underline-offset-2">
            ログイン画面に戻る
          </Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="パスワードの再設定" stepKey="email">
      <AuthReadyGate>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
          登録したメールアドレスを入力してください。パスワード再設定用のコードをお送りします。
        </p>
        <form onSubmit={handleSendCode} noValidate>
          <EmailField value={emailAddress} onChange={setEmailAddress} describedBy="reset-error" autoFocus />
          <AuthError id="reset-error" message={error} />
          <SubmitButton busy={busy} busyLabel="送信しています…">
            再設定コードを送信
          </SubmitButton>
        </form>
        <p className="mt-3 text-center">
          <Link href="/sign-in" className="inline-block min-h-11 py-2 text-sm text-[var(--color-text-secondary)] underline underline-offset-2">
            ログイン画面に戻る
          </Link>
        </p>
      </AuthReadyGate>
    </AuthShell>
  );
}
