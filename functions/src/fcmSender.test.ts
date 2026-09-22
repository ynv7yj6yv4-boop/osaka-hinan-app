// functions/src/fcmSender.ts の単体テスト。
//
// 【このファイルの位置づけ】sendFcmNotification()自体はFirebase Admin
// Messagingへの実I/Oを行うため、ここでは実送信を伴わずにテストできる
// isPermanentInvalidTokenErrorCode()(恒久的無効トークンの判定)のみを
// 検証する(要件定義書4 §5.8「恒久的無効トークンと一時的な送信失敗の区別」)。
// 実送信はモック化する方針(要件定義書4 §9)のため、実際の送信テストは
// notificationSendPipeline.test.tsでsendFnをモックして行う。

import { test } from "node:test";
import assert from "node:assert/strict";
import { isPermanentInvalidTokenErrorCode } from "./fcmSender";

test("isPermanentInvalidTokenErrorCode: messaging/registration-token-not-registeredは恒久的", () => {
  assert.equal(isPermanentInvalidTokenErrorCode("messaging/registration-token-not-registered"), true);
});

test("isPermanentInvalidTokenErrorCode: messaging/invalid-registration-tokenは恒久的", () => {
  assert.equal(isPermanentInvalidTokenErrorCode("messaging/invalid-registration-token"), true);
});

test("isPermanentInvalidTokenErrorCode: messaging/internal-error(一時的エラーの例)は恒久的ではない", () => {
  assert.equal(isPermanentInvalidTokenErrorCode("messaging/internal-error"), false);
});

test("isPermanentInvalidTokenErrorCode: messaging/server-unavailable(一時的エラーの例)は恒久的ではない", () => {
  assert.equal(isPermanentInvalidTokenErrorCode("messaging/server-unavailable"), false);
});

test("isPermanentInvalidTokenErrorCode: 未分類・不明なエラーコードは安全側(一時的)に倒す", () => {
  assert.equal(isPermanentInvalidTokenErrorCode("messaging/some-未知のコード"), false);
});

test("isPermanentInvalidTokenErrorCode: nullは恒久的ではない", () => {
  assert.equal(isPermanentInvalidTokenErrorCode(null), false);
});
