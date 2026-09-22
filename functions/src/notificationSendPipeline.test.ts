// functions/src/notificationSendPipeline.ts の単体テスト。
//
// 【このファイルの位置づけ】要件定義書4 §11「単体テスト」で要求されている
// 最重要項目(enabled=falseの場合に送信関数が一度も呼ばれないこと)を、
// sendFnをモック化して直接検証する。FCMの実送信(fcmSender.ts側のI/O)は
// 一切行わない(要件定義書4 §9)。

import { test } from "node:test";
import assert from "node:assert/strict";
import { processCandidateSend } from "./notificationSendPipeline";
import type { FcmSendResult } from "./fcmSender";
import type { NotificationDecisionResult } from "./notificationDecision";

const NOTIFICATION = { title: "テスト", body: "テスト本文" };
const NOW = new Date("2026-09-23T00:00:00.000Z");

const CANDIDATE: NotificationDecisionResult = { type: "candidate", reason: "test", decisionVersion: "v1" };
const NO_NOTIFICATION: NotificationDecisionResult = { type: "no_notification", reason: "test" };
const INSUFFICIENT_DATA: NotificationDecisionResult = { type: "insufficient_data", reason: "test" };
const COOLDOWN: NotificationDecisionResult = { type: "cooldown", reason: "test", nextEligibleAt: null };

function countingSendFn(result: FcmSendResult) {
  let calls = 0;
  const fn = async () => {
    calls++;
    return result;
  };
  return { fn, getCalls: () => calls };
}

test("【最重要】enabled=falseならcandidate判定でも送信関数(sendFn)は一度も呼ばれない", async () => {
  const { fn, getCalls } = countingSendFn({ ok: true });
  const outcome = await processCandidateSend(CANDIDATE, false, "token", NOW, fn, NOTIFICATION);
  assert.equal(getCalls(), 0);
  assert.equal(outcome.sendAttempted, false);
  assert.equal(outcome.cooldownUpdate, null);
  assert.equal(outcome.notificationEnabledUpdate, null);
});

for (const decision of [NO_NOTIFICATION, INSUFFICIENT_DATA, COOLDOWN]) {
  test(`decisionType=${decision.type}(candidate以外)はenabled=trueでも送信関数を呼ばない・フィールドを更新しない`, async () => {
    const { fn, getCalls } = countingSendFn({ ok: true });
    const outcome = await processCandidateSend(decision, true, "token", NOW, fn, NOTIFICATION);
    assert.equal(getCalls(), 0);
    assert.equal(outcome.sendAttempted, false);
    assert.equal(outcome.cooldownUpdate, null);
    assert.equal(outcome.notificationEnabledUpdate, null);
  });
}

test("enabled=trueかつcandidateで送信成功なら、送信関数は1回だけ呼ばれcooldownが更新される", async () => {
  const { fn, getCalls } = countingSendFn({ ok: true });
  const outcome = await processCandidateSend(CANDIDATE, true, "token", NOW, fn, NOTIFICATION);
  assert.equal(getCalls(), 1);
  assert.equal(outcome.sendAttempted, true);
  assert.equal(outcome.sendResult, "success");
  assert.equal(outcome.sendErrorCode, null);
  assert.equal(outcome.autoDisabledPoint, false);
  assert.deepEqual(outcome.cooldownUpdate, { lastNotifiedAt: NOW.toISOString(), lastNotificationState: "sent" });
  assert.equal(outcome.notificationEnabledUpdate, null);
});

test("一時的な送信失敗: cooldownは更新されず、notificationEnabledも変更しない", async () => {
  const { fn } = countingSendFn({ ok: false, errorCode: "messaging/internal-error", permanent: false });
  const outcome = await processCandidateSend(CANDIDATE, true, "token", NOW, fn, NOTIFICATION);
  assert.equal(outcome.sendAttempted, true);
  assert.equal(outcome.sendResult, "failed");
  assert.equal(outcome.sendErrorCode, "messaging/internal-error");
  assert.equal(outcome.autoDisabledPoint, false);
  assert.equal(outcome.cooldownUpdate, null);
  assert.equal(outcome.notificationEnabledUpdate, null);
});

test("恒久的な無効トークン: cooldownは更新されず、notificationEnabled=falseへの変更が返る", async () => {
  const { fn } = countingSendFn({
    ok: false,
    errorCode: "messaging/registration-token-not-registered",
    permanent: true,
  });
  const outcome = await processCandidateSend(CANDIDATE, true, "token", NOW, fn, NOTIFICATION);
  assert.equal(outcome.sendAttempted, true);
  assert.equal(outcome.sendResult, "failed");
  assert.equal(outcome.sendErrorCode, "messaging/registration-token-not-registered");
  assert.equal(outcome.autoDisabledPoint, true);
  assert.equal(outcome.cooldownUpdate, null);
  assert.equal(outcome.notificationEnabledUpdate, false);
});
