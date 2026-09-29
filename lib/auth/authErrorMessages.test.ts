// Phase 7: Clerkのエラー → 利用者向け日本語メッセージ変換のテスト（Clerkへの通信なし・モック）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { extractClerkErrorCode, toAuthErrorMessage, NETWORK_ERROR_MESSAGE } from "./authErrorMessages.ts";

// ClerkAPIResponseError相当（errors[].code を持つ）
const apiError = (code: string, extra: Record<string, unknown> = {}) => ({
  errors: [{ code, message: "internal english message", longMessage: "internal long message" }],
  ...extra,
});

test("エラーコードはClerkAPIResponseErrorのerrors[0].code、FieldError/RuntimeErrorのcodeから取り出す", () => {
  assert.equal(extractClerkErrorCode(apiError("form_code_incorrect")), "form_code_incorrect");
  assert.equal(extractClerkErrorCode({ code: "form_password_pwned", message: "x" }), "form_password_pwned");
  assert.equal(extractClerkErrorCode({ status: 429 }), "too_many_requests");
  assert.equal(extractClerkErrorCode(null), null);
  assert.equal(extractClerkErrorCode("string error"), null);
});

test("新規登録: 既存メールアドレス・無効なメールアドレス・弱い/流出パスワードを日本語で案内する", () => {
  assert.match(toAuthErrorMessage(apiError("form_identifier_exists"), "sign_up"), /すでに登録/);
  assert.match(toAuthErrorMessage(apiError("form_param_format_invalid"), "sign_up"), /メールアドレス/);
  assert.match(toAuthErrorMessage(apiError("form_password_pwned"), "sign_up"), /流出/);
  assert.match(toAuthErrorMessage(apiError("form_password_length_too_short"), "sign_up"), /短すぎ/);
  assert.match(toAuthErrorMessage(apiError("form_password_not_strong_enough"), "sign_up"), /複雑/);
});

test("確認コード: 間違ったコード・期限切れ・失敗を区別して案内する", () => {
  assert.match(toAuthErrorMessage(apiError("form_code_incorrect"), "verify_code"), /正しくありません/);
  assert.match(toAuthErrorMessage(apiError("verification_expired"), "verify_code"), /有効期限/);
  assert.match(toAuthErrorMessage(apiError("verification_failed"), "verify_code"), /再送/);
});

test("ログイン: 存在しないユーザーと誤ったパスワードは同じ文言（アカウントの有無を推測させない）", () => {
  const notFound = toAuthErrorMessage(apiError("form_identifier_not_found"), "sign_in");
  const wrongPassword = toAuthErrorMessage(apiError("form_password_incorrect"), "sign_in");
  assert.equal(notFound, wrongPassword);
  assert.match(notFound, /メールアドレスまたはパスワードが正しくありません/);
});

test("パスワード再設定: 存在しないメールアドレスでも登録の有無を断定しない文言にする", () => {
  const message = toAuthErrorMessage(apiError("form_identifier_not_found"), "reset_password");
  assert.doesNotMatch(message, /存在しません|登録されていません/);
});

test("送信回数の制限（429・too_many_requests）は、時間をおいて再試行するよう案内する", () => {
  assert.match(toAuthErrorMessage({ status: 429 }, "verify_code"), /しばらく待って/);
  assert.match(toAuthErrorMessage(apiError("too_many_requests"), "sign_in"), /しばらく待って/);
});

test("通信障害（network_error・fetch失敗）は、入力ミスではなく通信環境の確認を促す", () => {
  assert.equal(toAuthErrorMessage({ code: "network_error" }, "sign_in"), NETWORK_ERROR_MESSAGE);
  assert.equal(toAuthErrorMessage(new TypeError("Failed to fetch"), "sign_up"), NETWORK_ERROR_MESSAGE);
  assert.equal(toAuthErrorMessage({ cause: new TypeError("NetworkError when attempting to fetch resource.") }, "sign_in"), NETWORK_ERROR_MESSAGE);
  assert.notEqual(NETWORK_ERROR_MESSAGE, toAuthErrorMessage(apiError("form_password_incorrect"), "sign_in"));
});

test("未知のエラーは内部情報（英語メッセージ・JSON・コード名）を出さず、汎用メッセージにする", () => {
  for (const context of ["sign_up", "sign_in", "verify_code", "reset_password"] as const) {
    const message = toAuthErrorMessage(apiError("some_unknown_internal_code"), context);
    assert.doesNotMatch(message, /internal|some_unknown_internal_code|\{|"/);
    assert.match(message, /時間をおいて/);
  }
});
