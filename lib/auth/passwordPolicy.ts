// Phase 7: パスワード条件の表示文言を、Clerkに設定されている実際のパスワード
// ポリシーから組み立てる（アプリ側で独自の条件を作らない。判定もClerkが行う）。
//
// ポリシーはClerk Frontend APIの公開エンドポイント（/v1/environment の
// user_settings.password_settings）から取得する。公開鍵（publishable key）だけで
// 取得できる公開情報であり、秘密鍵は使わない。Clerk Dashboardで条件を変えれば、
// この表示も自動的に追従する。

export type ClerkPasswordSettings = {
  min_length?: number;
  max_length?: number;
  require_special_char?: boolean;
  require_numbers?: boolean;
  require_uppercase?: boolean;
  require_lowercase?: boolean;
  disable_hibp?: boolean;
  min_zxcvbn_strength?: number;
};

/** 取得できなかった場合の文言（具体的な数値は断定しない）。 */
export const FALLBACK_PASSWORD_REQUIREMENT_TEXT =
  "条件を満たさない場合は、理由を表示します。他のサービスで使っていない、推測されにくいパスワードにしてください。";

export function describePasswordPolicy(settings: ClerkPasswordSettings | null | undefined): string {
  if (!settings) return FALLBACK_PASSWORD_REQUIREMENT_TEXT;
  const parts: string[] = [];
  if (settings.min_length && settings.min_length > 0) parts.push(`${settings.min_length}文字以上`);
  const include: string[] = [];
  if (settings.require_lowercase) include.push("英小文字");
  if (settings.require_uppercase) include.push("英大文字");
  if (settings.require_numbers) include.push("数字");
  if (settings.require_special_char) include.push("記号");
  if (include.length > 0) parts.push(`${include.join("・")}を含む`);
  const head = parts.length > 0 ? `${parts.join("、")}。` : "";
  const leaked = settings.disable_hibp === false ? "過去に流出が確認されたパスワードは使えません。" : "";
  return `${head}${leaked}他のサービスで使っていない、推測されにくいパスワードにしてください。`;
}

/** 公開鍵からClerk Frontend APIのホスト名を取り出す（pk_test_<base64(host$)>形式）。 */
export function frontendApiHostFromPublishableKey(publishableKey: string | undefined): string | null {
  if (!publishableKey) return null;
  const encoded = publishableKey.split("_")[2];
  if (!encoded) return null;
  try {
    const decoded = atob(encoded).replace(/\$$/, "");
    return /^[a-z0-9.-]+$/i.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/** サーバー側で現在のパスワードポリシーを取得し、表示文言にする。失敗時は汎用文言。 */
export async function fetchPasswordRequirementText(): Promise<string> {
  const host = frontendApiHostFromPublishableKey(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  if (!host) return FALLBACK_PASSWORD_REQUIREMENT_TEXT;
  try {
    const res = await fetch(`https://${host}/v1/environment`, { next: { revalidate: 300 } });
    if (!res.ok) return FALLBACK_PASSWORD_REQUIREMENT_TEXT;
    const env = (await res.json()) as { user_settings?: { password_settings?: ClerkPasswordSettings } };
    return describePasswordPolicy(env.user_settings?.password_settings);
  } catch {
    return FALLBACK_PASSWORD_REQUIREMENT_TEXT;
  }
}
