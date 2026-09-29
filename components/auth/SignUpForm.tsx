"use client";

// Phase 7: 新規登録（メールアドレス＋パスワード → メール確認コード → 登録完了 → マップ）。
//
// 認証ロジックはすべてClerkに委ねる（Clerk公式のcustom flow。@clerk/nextjs v7の
// useSignUp() / SignUpFuture APIを使用）:
//   1. signUp.password({ emailAddress, password }) で登録を開始
//   2. signUp.verifications.sendEmailCode() でClerkが確認コードをメール送信
//   3. signUp.verifications.verifyEmailCode({ code }) で確認
//   4. status === "complete" なら signUp.finalize() でセッションを有効化
// 確認コードの生成・保存・有効期限・照合はすべてClerk側で行われ、このアプリは
// コードもパスワードも保存しない。

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { useSignUp } from "@clerk/nextjs";
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
import { SIGN_UP_START_TIMEOUT_MS } from "@/lib/auth/authConfig";

const SIGN_UP_START_TIMEOUT_MESSAGE =
  "認証処理を開始できませんでした。通信環境をご確認のうえ、もう一度お試しください。下にボット対策の確認欄が表示されている場合は、先に確認を完了してください。";

const INCOMPLETE_SETTINGS_MESSAGE =
  "現在、新規登録を完了できません。時間をおいて、もう一度お試しください。";

/** passwordRequirementText: Clerkに設定された実際のパスワード条件から組み立てた案内文
 *  （サーバー側でlib/auth/passwordPolicy.tsが取得してページから渡す）。 */
export default function SignUpForm({ passwordRequirementText }: { passwordRequirementText: string }) {
  const { signUp, fetchStatus } = useSignUp();
  const [emailAddress, setEmailAddress] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cooldownStartedAt, setCooldownStartedAt] = useState(0);
  const [codeSent, setCodeSent] = useState(false);
  // 登録開始がSIGN_UP_START_TIMEOUT_MSを超えても終わらない場合（ボット対策の確認が
  // 完了しない等）はtrueにし、送信中の表示を解除して再試行できるようにする。
  const [startStalled, setStartStalled] = useState(false);
  // 再試行した後に、前回の試行の結果が遅れて届いても画面を上書きしないための番号。
  const submitAttemptRef = useRef(0);
  const busy = fetchStatus === "fetching" && !startStalled;

  // Clerkのsign-up状態から、確認コード入力の段階かどうかを判断する
  // （ページを再読み込みしても、Clerk側に残っている登録途中の状態から再開できる）。
  const awaitingEmailCode =
    signUp.status === "missing_requirements" &&
    signUp.unverifiedFields.includes("email_address") &&
    signUp.missingFields.length === 0 &&
    (codeSent || signUp.verifications.emailAddress.status === "unverified");

  async function sendCode(): Promise<boolean> {
    const { error: sendError } = await signUp.verifications.sendEmailCode();
    setCooldownStartedAt(Date.now());
    if (sendError) {
      setError(toAuthErrorMessage(sendError, "verify_code"));
      return false;
    }
    setCodeSent(true);
    return true;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setStartStalled(false);
    const attempt = ++submitAttemptRef.current;
    // Clerkの処理自体は取り消さない（ボット対策を省略しない）。一定時間たっても
    // 応答が無い場合に、画面だけを操作可能な状態へ戻す（入力内容は消さない）。
    const timer = setTimeout(() => {
      if (submitAttemptRef.current !== attempt) return;
      setStartStalled(true);
      setError(SIGN_UP_START_TIMEOUT_MESSAGE);
    }, SIGN_UP_START_TIMEOUT_MS);
    let passwordError: unknown;
    try {
      ({ error: passwordError } = await signUp.password({ emailAddress: emailAddress.trim(), password }));
    } finally {
      clearTimeout(timer);
    }
    if (submitAttemptRef.current !== attempt) return;
    // タイムアウト表示の後に、ボット対策の確認が完了して応答が遅れて届いた場合は、
    // タイムアウトの文言を消してそのまま続ける（確認コード画面へ古い文言を持ち込まない）。
    setStartStalled(false);
    setError(null);
    if (passwordError) {
      setError(toAuthErrorMessage(passwordError, "sign_up"));
      return;
    }
    if (signUp.missingFields.length > 0) {
      // Clerk Dashboardで、メールアドレス・パスワード以外の項目（氏名等）が
      // 必須に設定されている場合。このアプリの登録画面では入力できないため案内する。
      setError(INCOMPLETE_SETTINGS_MESSAGE);
      return;
    }
    await sendCode();
  }

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const { error: verifyError } = await signUp.verifications.verifyEmailCode({ code });
    if (verifyError) {
      setError(toAuthErrorMessage(verifyError, "verify_code"));
      return;
    }
    if (signUp.status !== "complete") {
      setError(INCOMPLETE_SETTINGS_MESSAGE);
      return;
    }
    const { error: finalizeError } = await signUp.finalize({
      navigate: createFinalizeNavigate(() => setError(SESSION_TASK_MESSAGE)),
    });
    if (finalizeError) setError(toAuthErrorMessage(finalizeError, "sign_up"));
  }

  async function handleResend() {
    setError(null);
    setInfo(null);
    if (await sendCode()) setInfo("確認コードを再送しました。メールをご確認ください。");
  }

  async function handleChangeEmail() {
    setError(null);
    setInfo(null);
    setCode("");
    setCodeSent(false);
    await signUp.reset();
  }

  if (awaitingEmailCode) {
    return (
      <AuthShell title="メールを確認してください" stepKey="verify">
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
          <span className="break-all font-bold text-[var(--color-text-primary)]">{signUp.emailAddress ?? emailAddress}</span>
          {" "}に確認コードを送信しました。
        </p>
        <EmailCodeNote />
        <form onSubmit={handleVerify} noValidate>
          <CodeField value={code} onChange={setCode} describedBy="signup-error" />
          <AuthError id="signup-error" message={error} />
          <AuthInfo message={info} />
          <SubmitButton busy={busy} busyLabel="確認しています…">
            確認する
          </SubmitButton>
        </form>
        <ResendCodeButton onResend={handleResend} cooldownStartedAt={cooldownStartedAt} />
        <button
          type="button"
          onClick={handleChangeEmail}
          className="mt-1 min-h-11 w-full text-sm text-[var(--color-text-secondary)] underline underline-offset-2"
        >
          メールアドレスを入力し直す
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="アカウントを作成" stepKey="form">
      <AuthReadyGate>
        <form onSubmit={handleSubmit} noValidate>
          <EmailField value={emailAddress} onChange={setEmailAddress} describedBy="signup-error" autoFocus />
          <PasswordField
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            hint={passwordRequirementText}
            describedBy="signup-error"
          />
          <AuthError id="signup-error" message={error} />
          {/* Clerkのボット対策（CAPTCHA）用。サインアップ画面に必須。 */}
          <div id="clerk-captcha" className="mt-3" />
          <SubmitButton busy={busy} busyLabel="送信しています…">
            アカウントを作成
          </SubmitButton>
        </form>
        <p className="mt-5 text-center text-sm text-[var(--color-text-secondary)]">
          すでにアカウントをお持ちの方
          <br />
          <Link href="/sign-in" className="inline-block min-h-11 py-2 font-bold text-[var(--color-primary)] underline underline-offset-2">
            ログイン
          </Link>
        </p>
      </AuthReadyGate>
    </AuthShell>
  );
}
