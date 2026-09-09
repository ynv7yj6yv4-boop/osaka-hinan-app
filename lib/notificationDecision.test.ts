// 試作3 PART 3: lib/notificationDecision.ts の単体テスト。
// 【最重要】enabled:falseの間、いかなる入力でも"candidate"にならないことを
// 必ず検証する（本番自動通知の誤発火防止の要）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateNotificationDecision, evaluateFloodRiskNotificationDecision } from "./notificationDecision.ts";
import type { NotificationDecisionConfig } from "./notificationDecisionConfig.ts";

const ENABLED_CONFIG: NotificationDecisionConfig = {
  enabled: true,
  decisionVersion: "test-v1",
  targetHazard: "flood",
  forecastHorizonMinutes: 30,
  rainfallRankThreshold: 6,
  hazardDepthRankThreshold: 1,
  cooldownMinutes: 60,
  totalRainfallWindowHours: 24,
  totalRainfallThresholdMm: 100,
};

const GOOD_HAZARD = { status: "evaluated" as const, depthRank: 2 as const };
const GOOD_RAINFALL = { status: "forecast" as const, rank: 7, leadTimeMinutes: 15 };
const NO_PREVIOUS = { lastNotificationState: null, lastNotifiedAt: null };

test("enabled:falseなら、条件を満たす入力でも必ずno_notificationになる（多重防御）", () => {
  const result = evaluateNotificationDecision({
    staticFloodHazard: GOOD_HAZARD,
    rainfallForecast: GOOD_RAINFALL,
    dataCompleteness: "complete",
    previousNotificationState: NO_PREVIOUS,
    config: { ...ENABLED_CONFIG, enabled: false },
  });
  assert.equal(result.type, "no_notification");
});

test("デフォルトのnotificationDecisionConfigはenabled:falseである", () => {
  const result = evaluateNotificationDecision({
    staticFloodHazard: GOOD_HAZARD,
    rainfallForecast: GOOD_RAINFALL,
    dataCompleteness: "complete",
    previousNotificationState: NO_PREVIOUS,
  });
  assert.equal(result.type, "no_notification");
});

test("enabled:trueかつ条件を満たせばcandidateになる", () => {
  const result = evaluateNotificationDecision({
    staticFloodHazard: GOOD_HAZARD,
    rainfallForecast: GOOD_RAINFALL,
    dataCompleteness: "complete",
    previousNotificationState: NO_PREVIOUS,
    config: ENABLED_CONFIG,
  });
  assert.equal(result.type, "candidate");
});

test("dataCompleteness=unavailableならinsufficient_data", () => {
  const result = evaluateNotificationDecision({
    staticFloodHazard: GOOD_HAZARD,
    rainfallForecast: GOOD_RAINFALL,
    dataCompleteness: "unavailable",
    previousNotificationState: NO_PREVIOUS,
    config: ENABLED_CONFIG,
  });
  assert.equal(result.type, "insufficient_data");
});

test("staticFloodHazard.status=unknownならinsufficient_data（unknownをoutside扱いしない）", () => {
  const result = evaluateNotificationDecision({
    staticFloodHazard: { status: "unknown", depthRank: 0 },
    rainfallForecast: GOOD_RAINFALL,
    dataCompleteness: "partial",
    previousNotificationState: NO_PREVIOUS,
    config: ENABLED_CONFIG,
  });
  assert.equal(result.type, "insufficient_data");
});

test("rainfallForecast.rank=nullならinsufficient_data", () => {
  const result = evaluateNotificationDecision({
    staticFloodHazard: GOOD_HAZARD,
    rainfallForecast: { status: "forecast", rank: null, leadTimeMinutes: 15 },
    dataCompleteness: "partial",
    previousNotificationState: NO_PREVIOUS,
    config: ENABLED_CONFIG,
  });
  assert.equal(result.type, "insufficient_data");
});

test("hazardDepthRankThreshold未満ならno_notification", () => {
  const result = evaluateNotificationDecision({
    staticFloodHazard: { status: "evaluated", depthRank: 0 },
    rainfallForecast: GOOD_RAINFALL,
    dataCompleteness: "complete",
    previousNotificationState: NO_PREVIOUS,
    config: ENABLED_CONFIG,
  });
  assert.equal(result.type, "no_notification");
});

test("rainfallRankThreshold未満ならno_notification", () => {
  const result = evaluateNotificationDecision({
    staticFloodHazard: GOOD_HAZARD,
    rainfallForecast: { status: "forecast", rank: 3, leadTimeMinutes: 15 },
    dataCompleteness: "complete",
    previousNotificationState: NO_PREVIOUS,
    config: ENABLED_CONFIG,
  });
  assert.equal(result.type, "no_notification");
});

test("cooldown期間内ならcooldownを返す", () => {
  const now = new Date("2026-09-08T12:00:00Z");
  const lastNotifiedAt = new Date("2026-09-08T11:30:00Z").toISOString(); // 30分前(cooldown=60分)
  const result = evaluateNotificationDecision({
    staticFloodHazard: GOOD_HAZARD,
    rainfallForecast: GOOD_RAINFALL,
    dataCompleteness: "complete",
    previousNotificationState: { lastNotificationState: "sent", lastNotifiedAt },
    config: ENABLED_CONFIG,
    now,
  });
  assert.equal(result.type, "cooldown");
});

test("cooldown期間を過ぎていればcandidateに戻る", () => {
  const now = new Date("2026-09-08T12:00:00Z");
  const lastNotifiedAt = new Date("2026-09-08T10:00:00Z").toISOString(); // 120分前(cooldown=60分)
  const result = evaluateNotificationDecision({
    staticFloodHazard: GOOD_HAZARD,
    rainfallForecast: GOOD_RAINFALL,
    dataCompleteness: "complete",
    previousNotificationState: { lastNotificationState: "sent", lastNotifiedAt },
    config: ENABLED_CONFIG,
    now,
  });
  assert.equal(result.type, "candidate");
});

// ============================================================
// 要件定義書3: evaluateFloodRiskNotificationDecision
// (「これから降り続けると予測される総雨量」ベースの判定)
// ============================================================

const GOOD_TOTAL_RAINFALL = { status: "evaluated" as const, totalPredictedRainfallMm: 150, windowHours: 24 };

test("[flood risk] enabled:falseなら、条件を満たす入力でも必ずno_notificationになる（多重防御）", () => {
  const result = evaluateFloodRiskNotificationDecision({
    staticFloodHazard: GOOD_HAZARD,
    totalPredictedRainfall: GOOD_TOTAL_RAINFALL,
    dataCompleteness: "complete",
    previousNotificationState: NO_PREVIOUS,
    config: { ...ENABLED_CONFIG, enabled: false },
  });
  assert.equal(result.type, "no_notification");
});

test("[flood risk] enabled:trueかつ予測総雨量が閾値以上ならcandidateになる", () => {
  const result = evaluateFloodRiskNotificationDecision({
    staticFloodHazard: GOOD_HAZARD,
    totalPredictedRainfall: GOOD_TOTAL_RAINFALL,
    dataCompleteness: "complete",
    previousNotificationState: NO_PREVIOUS,
    config: ENABLED_CONFIG,
  });
  assert.equal(result.type, "candidate");
});

test("[flood risk] totalPredictedRainfallMmが閾値未満ならno_notification", () => {
  const result = evaluateFloodRiskNotificationDecision({
    staticFloodHazard: GOOD_HAZARD,
    totalPredictedRainfall: { status: "evaluated", totalPredictedRainfallMm: 10, windowHours: 24 },
    dataCompleteness: "complete",
    previousNotificationState: NO_PREVIOUS,
    config: ENABLED_CONFIG,
  });
  assert.equal(result.type, "no_notification");
});

test("[flood risk] staticFloodHazardが区域外(depthRank=0)ならno_notification（総雨量だけでは候補にしない）", () => {
  const result = evaluateFloodRiskNotificationDecision({
    staticFloodHazard: { status: "evaluated", depthRank: 0 },
    totalPredictedRainfall: GOOD_TOTAL_RAINFALL,
    dataCompleteness: "complete",
    previousNotificationState: NO_PREVIOUS,
    config: ENABLED_CONFIG,
  });
  assert.equal(result.type, "no_notification");
});

test("[flood risk] staticFloodHazard.status=unknownならinsufficient_data（unknownをoutside扱いしない）", () => {
  const result = evaluateFloodRiskNotificationDecision({
    staticFloodHazard: { status: "unknown", depthRank: 0 },
    totalPredictedRainfall: GOOD_TOTAL_RAINFALL,
    dataCompleteness: "partial",
    previousNotificationState: NO_PREVIOUS,
    config: ENABLED_CONFIG,
  });
  assert.equal(result.type, "insufficient_data");
});

test("[flood risk] totalPredictedRainfallMm=nullならinsufficient_data（欠測を0扱いしない）", () => {
  const result = evaluateFloodRiskNotificationDecision({
    staticFloodHazard: GOOD_HAZARD,
    totalPredictedRainfall: { status: "unavailable", totalPredictedRainfallMm: null, windowHours: null },
    dataCompleteness: "partial",
    previousNotificationState: NO_PREVIOUS,
    config: ENABLED_CONFIG,
  });
  assert.equal(result.type, "insufficient_data");
});

test("[flood risk] dataCompleteness=unavailableならinsufficient_data", () => {
  const result = evaluateFloodRiskNotificationDecision({
    staticFloodHazard: GOOD_HAZARD,
    totalPredictedRainfall: GOOD_TOTAL_RAINFALL,
    dataCompleteness: "unavailable",
    previousNotificationState: NO_PREVIOUS,
    config: ENABLED_CONFIG,
  });
  assert.equal(result.type, "insufficient_data");
});

test("[flood risk] cooldown期間内ならcooldownを返す(evaluateNotificationDecisionと共通ロジック)", () => {
  const now = new Date("2026-09-08T12:00:00Z");
  const lastNotifiedAt = new Date("2026-09-08T11:30:00Z").toISOString(); // 30分前(cooldown=60分)
  const result = evaluateFloodRiskNotificationDecision({
    staticFloodHazard: GOOD_HAZARD,
    totalPredictedRainfall: GOOD_TOTAL_RAINFALL,
    dataCompleteness: "complete",
    previousNotificationState: { lastNotificationState: "sent", lastNotifiedAt },
    config: ENABLED_CONFIG,
    now,
  });
  assert.equal(result.type, "cooldown");
});
