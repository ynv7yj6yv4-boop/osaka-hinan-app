// 要件定義書4 §5.5・§5.8: functions/src/からFCM実送信を行うための、
// 判定ロジックから独立した送信関数。
//
// 【重要】lib/firebaseAdmin.tsのgetAdminMessaging()と同等のAdmin Messaging
// 初期化を行う。新規シークレットは追加せず、既存のGitHub Secrets 3つ
// (FIREBASE_ADMIN_PROJECT_ID / FIREBASE_ADMIN_CLIENT_EMAIL /
// FIREBASE_ADMIN_PRIVATE_KEY)で index.ts (Cloud Functions) /
// runStandalone.ts (GitHub Actions) が呼び出し時点までに済ませている
// initializeApp() をそのまま再利用する(ここでは新たにinitializeAppしない)。
//
// この関数自体を呼ぶかどうかの判定(enabled===trueかつcandidateの場合のみ)は
// notificationSendPipeline.ts側の責務であり、ここでは行わない
// (判定ロジックと送信処理の分離)。

import { getApps } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

export type FcmSendResult = { ok: true } | { ok: false; errorCode: string | null; permanent: boolean };

// 要件定義書4 §5.8: Firebase Admin SDKが「トークンが二度と有効化されない」ことを
// 明確に示すエラーコードのみ恒久的に無効と扱う。それ以外(未分類のエラーコードを
// 含む)は一時的として扱い、自動offにしない(安全側のデフォルト)。
const PERMANENT_INVALID_TOKEN_ERROR_CODES: ReadonlySet<string> = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

export function isPermanentInvalidTokenErrorCode(errorCode: string | null): boolean {
  return errorCode !== null && PERMANENT_INVALID_TOKEN_ERROR_CODES.has(errorCode);
}

function extractErrorCode(err: unknown): string | null {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
}

export async function sendFcmNotification(
  token: string,
  notification: { title: string; body: string }
): Promise<FcmSendResult> {
  try {
    const messaging = getMessaging(getApps()[0]);
    await messaging.send({ token, notification });
    return { ok: true };
  } catch (err) {
    const errorCode = extractErrorCode(err);
    return { ok: false, errorCode, permanent: isPermanentInvalidTokenErrorCode(errorCode) };
  }
}
