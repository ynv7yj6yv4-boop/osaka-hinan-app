// Phase 7: 認証まわりの設定値を1か所で管理する。

/** 確認コード再送ボタンをUI側で無効化する秒数。連打による大量送信を防ぐための
 *  控えめな値で、Clerk側のrate limitとは別（Clerkの制限に達した場合は、
 *  Clerkが返すエラーを「短時間に操作が集中しました」と表示する）。 */
export const RESEND_CODE_COOLDOWN_SECONDS = 30;

/** 再送ボタンが押せるようになるまでの残り秒数（0〜RESEND_CODE_COOLDOWN_SECONDS）。 */
export function resendCooldownRemainingSeconds(cooldownStartedAtMs: number, nowMs: number): number {
  const elapsedSeconds = Math.floor(Math.max(0, nowMs - cooldownStartedAtMs) / 1000);
  return Math.max(0, RESEND_CODE_COOLDOWN_SECONDS - elapsedSeconds);
}

/** Clerkの読み込み（セッション確認）がこの時間を超えても終わらない場合、
 *  真っ白な画面のままにせず、通信環境の確認を促す表示に切り替える。 */
export const AUTH_LOADING_TIMEOUT_MS = 10000;

/**
 * 新規登録の開始（signUp.password()）が、この時間を超えても終わらない場合は、
 * 送信中の表示を解除して再試行できるようにする。
 *
 * 【対象を新規登録だけにしている理由】Clerkのボット対策（Cloudflare Turnstile）は
 * 新規登録でのみ実行される（ログイン・パスワード再設定ではTurnstileへの通信が
 * 発生しないことを実測で確認）。Turnstileが読み込まれたのに確認が完了しない場合、
 * Clerkの処理が応答を返さず「送信しています…」のまま止まることがある。
 * Turnstileのスクリプト自体を取得できない場合は、Clerkが約10秒で失敗を返す。
 *
 * 【値の根拠】Turnstileの確認は通常数秒で終わる。操作が必要な確認が表示された
 * 場合の所要時間も考え、通常の通信で誤って失敗扱いにしないよう30秒とした。
 * タイムアウトしてもClerkの処理を取り消したりボット対策を省略したりはしない
 * （画面を操作可能に戻すだけで、確認が終わっていない登録は成立しない）。
 */
export const SIGN_UP_START_TIMEOUT_MS = 30000;

/**
 * 確認コード入力画面に添える案内。確認コード・再設定コードのメールはClerkが
 * 送信し、文面は英語のまま（メールテンプレートの日本語化はClerkの有料プランの
 * 機能のため、現時点では行っていない）。英語のメールで戸惑わないよう案内する。
 */
export const EMAIL_LANGUAGE_NOTE =
  "確認コードのメールは英語で届きます。メール内に記載された6桁の数字を入力してください。";

/** ログイン・登録完了後の移動先（避難支援マップ）。 */
export const AFTER_AUTH_PATH = "/";
