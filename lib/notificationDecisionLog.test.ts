// 試作3: lib/notificationDecisionLog.ts の単体テスト。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildNotificationDecisionLogEntry,
  summarizeNotificationFrequency,
  type NotificationDecisionLogEntry,
} from "./notificationDecisionLog.ts";

function entry(type: NotificationDecisionLogEntry["result"]["type"]): NotificationDecisionLogEntry {
  return buildNotificationDecisionLogEntry({
    monitoringPointId: "p1",
    decisionVersion: "test-v0",
    staticFloodHazardStatus: "evaluated",
    staticFloodHazardDepthRank: 2,
    rainfallForecastStatus: "forecast",
    rainfallForecastRank: 5,
    dataCompleteness: "complete",
    result:
      type === "candidate"
        ? { type: "candidate", reason: "test", decisionVersion: "test-v0" }
        : type === "cooldown"
          ? { type: "cooldown", reason: "test", nextEligibleAt: null }
          : { type, reason: "test" },
  });
}

test("summarizeNotificationFrequency: 種類ごとの件数とcandidateRatioを正しく集計する", () => {
  const entries = [
    entry("candidate"),
    entry("no_notification"),
    entry("no_notification"),
    entry("insufficient_data"),
  ];
  const stats = summarizeNotificationFrequency(entries);
  assert.equal(stats.totalEvaluations, 4);
  assert.equal(stats.candidateCount, 1);
  assert.equal(stats.noNotificationCount, 2);
  assert.equal(stats.insufficientDataCount, 1);
  assert.equal(stats.candidateRatio, 0.25);
});

test("summarizeNotificationFrequency: 空配列ならcandidateRatioはnull", () => {
  const stats = summarizeNotificationFrequency([]);
  assert.equal(stats.totalEvaluations, 0);
  assert.equal(stats.candidateRatio, null);
});
