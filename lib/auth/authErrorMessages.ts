// Phase 7: Clerkのエラーを、利用者向けの日本語メッセージへ変換する。
//
// 【方針】
// - Clerkが返すエラーの内容（JSON・英語の内部メッセージ・コード名）は画面に出さない。
// - 認証ロジック自体はすべてClerkに委ね、ここでは「表示する文言」だけを決める。
// - ログイン時の「メールアドレスが存在しない」と「パスワードが違う」は、アカウントの
//   有無を第三者に推測されないよう、同じ文言にする。
// - 通信障害（Clerkへ接続できない）は、入力ミスとは別の文言にする（災害時に
//   「ログイン失敗」と「通信障害」を区別できるようにするため）。
//
// エラーコードはClerk Frontend APIのエラーコード（ClerkAPIResponseError.errors[].code
// およびErrors.fields.*.code）。

export type AuthErrorContext = "sign_up" | "sign_in" | "verify_code" | "reset_password";

export const NETWORK_ERROR_MESSAGE =
  "認証サーバーに接続できませんでした。通信環境をご確認のうえ、もう一度お試しください。";

const GENERIC_ERROR_MESSAGE = "処理を完了できませんでした。時間をおいて、もう一度お試しください。";

const SIGN_IN_CREDENTIALS_MESSAGE = "メールアドレスまたはパスワードが正しくありません。";

const MESSAGES: Record<string, string> = {
  // 新規登録
  form_identifier_exists: "このメールアドレスはすでに登録されています。ログイン画面からログインしてください。",
  form_email_address_blocked: "このメールアドレスは登録に使用できません。別のメールアドレスをお試しください。",
  form_password_pwned:
    "このパスワードは、過去に他のサービスから流出したことが確認されているため使用できません。別のパスワードを設定してください。",
  form_password_length_too_short: "パスワードが短すぎます。",
  form_password_length_too_long: "パスワードが長すぎます。",
  form_password_size_in_bytes_exceeded: "パスワードが長すぎます。",
  form_password_not_strong_enough: "パスワードが推測されやすい可能性があります。より複雑なパスワードを設定してください。",
  form_password_validation_failed: "パスワードが条件を満たしていません。",
  form_param_format_invalid: "入力の形式が正しくありません。メールアドレスをご確認ください。",
  form_param_nil: "未入力の項目があります。",
  form_param_missing: "未入力の項目があります。",
  captcha_invalid: "ボット対策の確認に失敗しました。ページを再読み込みして、もう一度お試しください。",
  captcha_unavailable: "ボット対策の確認に失敗しました。ページを再読み込みして、もう一度お試しください。",

  // 確認コード
  form_code_incorrect: "確認コードが正しくありません。メールに記載された数字をご確認ください。",
  verification_expired: "確認コードの有効期限が切れています。「確認コードを再送」から新しいコードを受け取ってください。",
  verification_failed: "確認に失敗しました。「確認コードを再送」から新しいコードを受け取ってください。",
  verification_already_verified: "このメールアドレスはすでに確認済みです。",

  // ログイン
  form_identifier_not_found: SIGN_IN_CREDENTIALS_MESSAGE,
  form_password_incorrect: SIGN_IN_CREDENTIALS_MESSAGE,
  strategy_for_user_invalid: SIGN_IN_CREDENTIALS_MESSAGE,
  user_locked: "ログインの試行回数が多すぎるため、一時的にログインできません。しばらく待ってからお試しください。",

  // 共通
  too_many_requests: "短時間に操作が集中しました。しばらく待ってから、もう一度お試しください。",
  rate_limit_exceeded: "短時間に操作が集中しました。しばらく待ってから、もう一度お試しください。",
  network_error: NETWORK_ERROR_MESSAGE,
};

/** Clerkのエラー（ClerkAPIResponseError・ClerkRuntimeError・FieldError等）から
 *  エラーコードを取り出す。取り出せない場合はnull。 */
export function extractClerkErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const e = error as { errors?: Array<{ code?: unknown }>; code?: unknown; status?: unknown };
  const apiCode = e.errors?.[0]?.code;
  if (typeof apiCode === "string" && apiCode) return apiCode;
  if (typeof e.code === "string" && e.code) return e.code;
  if (e.status === 429) return "too_many_requests";
  return null;
}

/** 通信障害（ブラウザがClerkへ到達できなかった）とみなせるエラーか。 */
export function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const code = extractClerkErrorCode(error);
  if (code === "network_error") return true;
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) return true;
  const cause = (error as { cause?: unknown } | null)?.cause;
  return cause instanceof TypeError && /fetch|network/i.test(cause.message);
}

/**
 * Clerkのエラーを利用者向けの日本語メッセージへ変換する。
 * 未知のコードは内部情報を出さず、汎用メッセージにする。
 */
export function toAuthErrorMessage(error: unknown, context: AuthErrorContext): string {
  if (isNetworkError(error)) return NETWORK_ERROR_MESSAGE;
  const code = extractClerkErrorCode(error);
  if (code && MESSAGES[code]) {
    // パスワード再設定で存在しないメールアドレスを指定された場合も、
    // 登録の有無を推測されないよう、送信先の確認を促す文言にする。
    // Clerkは、ログイン時にも流出が確認されたパスワードを拒否する設定になっている
    // （enforce_hibp_on_sign_in）。その場合はパスワードの再設定を案内する。
    if (context === "sign_in" && code === "form_password_pwned") {
      return "このパスワードは、過去に他のサービスから流出したことが確認されたため、現在は使用できません。「パスワードを忘れた場合」から新しいパスワードを設定してください。";
    }
    if (context === "reset_password" && code === "form_identifier_not_found") {
      return "入力されたメールアドレスに再設定コードを送信できませんでした。登録したメールアドレスをご確認ください。";
    }
    return MESSAGES[code];
  }
  return GENERIC_ERROR_MESSAGE;
}
