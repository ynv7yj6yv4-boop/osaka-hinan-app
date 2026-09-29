"use client";

// Phase 7: ログイン（メールアドレス＋パスワード）。
//
// Clerk公式のcustom flow（@clerk/nextjs v7のuseSignIn() / SignInFuture API）:
//   1. signIn.password({ emailAddress, password })
//   2. status === "complete" → signIn.finalize() でセッションを有効化 → マップへ
//   3. status === "needs_client_trust"（Clerkの「Device Trust」: 初めての端末等で
//      本人確認を追加で求められた場合）→ signIn.mfa.sendEmailCode() で
//      Clerkが確認コードをメール送信 → signIn.mfa.verifyEmailCode() → finalize()
// パスワードはClerkへ送るだけで、このアプリでは保存しない。

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useSignIn } from "@clerk/nextjs";
import {
  AuthError,
  AuthInfo,
  AuthReadyGate,
  AuthShell,
  CodeField,
  EmailField,
  PasswordField,
  ResendCodeButton,
  SubmitButton,
} from "./AuthUi";
import { createFinalizeNavigate, SESSION_TASK_MESSAGE } from "./finishAuth";
import { toAuthErrorMessage } from "@/lib/auth/authErrorMessages";

const UNSUPPORTED_STEP_MESSAGE =
  "このアカウントでは、この画面からログインを完了できません。時間をおいて、もう一度お試しください。";

export default function SignInForm() {
  const { signIn, fetchStatus } = useSignIn();
  const [emailAddress, setEmailAddress] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cooldownStartedAt, setCooldownStartedAt] = useState(0);
  const busy = fetchStatus === "fetching";

  async function finalize() {
    const { error: finalizeError } = await signIn.finalize({
      navigate: createFinalizeNavigate(() => setError(SESSION_TASK_MESSAGE)),
    });
    if (finalizeError) setError(toAuthErrorMessage(finalizeError, "sign_in"));
  }

  async function sendTrustCode(): Promise<boolean> {
    const { error: sendError } = await signIn.mfa.sendEmailCode();
    setCooldownStartedAt(Date.now());
    if (sendError) {
      setError(toAuthErrorMessage(sendError, "verify_code"));
      return false;
    }
    return true;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const { error: signInError } = await signIn.password({ emailAddress: emailAddress.trim(), password });
    if (signInError) {
      setError(toAuthErrorMessage(signInError, "sign_in"));
      return;
    }
    if (signIn.status === "complete") {
      await finalize();
    } else if (signIn.status === "needs_client_trust") {
      const hasEmailCode = signIn.supportedSecondFactors.some((f) => f.strategy === "email_code");
      if (hasEmailCode) await sendTrustCode();
      else setError(UNSUPPORTED_STEP_MESSAGE);
    } else {
      // needs_second_factor（MFA）等。MFAは今回のPhaseでは対象外。
      setError(UNSUPPORTED_STEP_MESSAGE);
    }
  }

  async function handleVerifyTrust(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const { error: verifyError } = await signIn.mfa.verifyEmailCode({ code });
    if (verifyError) {
      setError(toAuthErrorMessage(verifyError, "verify_code"));
      return;
    }
    if (signIn.status === "complete") await finalize();
    else setError(UNSUPPORTED_STEP_MESSAGE);
  }

  async function handleStartOver() {
    setError(null);
    setInfo(null);
    setCode("");
    setPassword("");
    await signIn.reset();
  }

  if (signIn.status === "needs_client_trust") {
    return (
      <AuthShell title="本人確認のコードを入力" stepKey="client-trust">
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
          いつもと異なる端末・ブラウザからのログインのため、登録メールアドレスに確認コードを送信しました。メールに記載された6桁の数字を入力してください。
        </p>
        <form onSubmit={handleVerifyTrust} noValidate>
          <CodeField value={code} onChange={setCode} describedBy="signin-error" />
          <AuthError id="signin-error" message={error} />
          <AuthInfo message={info} />
          <SubmitButton busy={busy} busyLabel="確認しています…">
            確認してログイン
          </SubmitButton>
        </form>
        <ResendCodeButton
          cooldownStartedAt={cooldownStartedAt}
          onResend={async () => {
            setError(null);
            setInfo(null);
            if (await sendTrustCode()) setInfo("確認コードを再送しました。メールをご確認ください。");
          }}
        />
        <button
          type="button"
          onClick={handleStartOver}
          className="mt-1 min-h-11 w-full text-sm text-[var(--color-text-secondary)] underline underline-offset-2"
        >
          最初からやり直す
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="ログイン" stepKey="form">
      <AuthReadyGate>
        <form onSubmit={handleSubmit} noValidate>
          <EmailField value={emailAddress} onChange={setEmailAddress} describedBy="signin-error" autoFocus />
          <PasswordField value={password} onChange={setPassword} autoComplete="current-password" describedBy="signin-error" />
          <AuthError id="signin-error" message={error} />
          <SubmitButton busy={busy} busyLabel="ログインしています…">
            ログイン
          </SubmitButton>
        </form>
        <p className="mt-3 text-center">
          <Link href="/forgot-password" className="inline-block min-h-11 py-2 text-sm font-bold text-[var(--color-primary)] underline underline-offset-2">
            パスワードを忘れた場合
          </Link>
        </p>
        <p className="mt-3 border-t border-[var(--color-border)] pt-4 text-center text-sm text-[var(--color-text-secondary)]">
          はじめてご利用の方
          <br />
          <Link href="/sign-up" className="inline-block min-h-11 py-2 font-bold text-[var(--color-primary)] underline underline-offset-2">
            アカウントを作成
          </Link>
        </p>
      </AuthReadyGate>
    </AuthShell>
  );
}
