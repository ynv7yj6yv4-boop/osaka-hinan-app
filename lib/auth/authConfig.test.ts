// Phase 7: 確認コード再送のクールダウン計算のテスト。

import { test } from "node:test";
import assert from "node:assert/strict";
import { RESEND_CODE_COOLDOWN_SECONDS, resendCooldownRemainingSeconds } from "./authConfig.ts";

test("送信直後は再送できず、クールダウン秒数が残る", () => {
  assert.equal(resendCooldownRemainingSeconds(1_000_000, 1_000_000), RESEND_CODE_COOLDOWN_SECONDS);
});

test("時間の経過とともに残り秒数が減り、経過後は0（再送可能）になる", () => {
  assert.equal(resendCooldownRemainingSeconds(0, 10_500), RESEND_CODE_COOLDOWN_SECONDS - 10);
  assert.equal(resendCooldownRemainingSeconds(0, RESEND_CODE_COOLDOWN_SECONDS * 1000), 0);
  assert.equal(resendCooldownRemainingSeconds(0, 999_999_999), 0);
});

test("まだ一度も送信していない（開始時刻0）場合は、すぐに再送できる", () => {
  assert.equal(resendCooldownRemainingSeconds(0, Date.now()), 0);
});

test("時計のずれ等で開始時刻が現在より後でも、クールダウン秒数を超えない", () => {
  assert.equal(resendCooldownRemainingSeconds(2_000_000, 1_000_000), RESEND_CODE_COOLDOWN_SECONDS);
});
