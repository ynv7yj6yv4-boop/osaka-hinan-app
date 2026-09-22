// functions/src/notificationLog.ts の単体テスト(要件定義書4 §5.7・§7・§11)。

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveGitCommitHash, shouldWriteNotificationLog } from "./notificationLog";

// --- shouldWriteNotificationLog ---

test("shouldWriteNotificationLog: 初回評価(previousがnull)は記録する", () => {
  assert.equal(shouldWriteNotificationLog(null, "no_notification", false), true);
});

test("shouldWriteNotificationLog: decisionTypeが変化した場合は記録する", () => {
  assert.equal(shouldWriteNotificationLog("no_notification", "candidate", false), true);
});

test("shouldWriteNotificationLog: decisionTypeが変化なし・送信も試みていない場合は記録しない", () => {
  assert.equal(shouldWriteNotificationLog("no_notification", "no_notification", false), false);
});

test("shouldWriteNotificationLog: decisionTypeが変化なしでも送信を試みた場合は記録する", () => {
  assert.equal(shouldWriteNotificationLog("candidate", "candidate", true), true);
});

// --- resolveGitCommitHash ---

test("resolveGitCommitHash: GITHUB_SHAが設定されていればその値を返す", () => {
  assert.equal(resolveGitCommitHash({ GITHUB_SHA: "abc123" } as NodeJS.ProcessEnv), "abc123");
});

test("resolveGitCommitHash: GITHUB_SHAが未設定ならnullを返す(ローカル実行等で壊れない)", () => {
  assert.equal(resolveGitCommitHash({} as NodeJS.ProcessEnv), null);
});

test("resolveGitCommitHash: GITHUB_SHAが空文字ならnullを返す", () => {
  assert.equal(resolveGitCommitHash({ GITHUB_SHA: "" } as NodeJS.ProcessEnv), null);
});
