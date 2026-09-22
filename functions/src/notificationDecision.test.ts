// functions/src/notificationDecision.ts の最小限の単体テスト。
//
// 【このファイルの位置づけ】functions/src/notificationDecision.tsは
// lib/notificationDecision.tsと判定ロジックを同期させる意図的な複製であり、
// lib側には既に詳細なテスト(lib/notificationDecision.test.ts)がある。
// そのため、ここでは全パターンを網羅し直すのではなく、
// 「このコピーが最も安全側の設計(enabled:falseの多重防御)を保っているか」
// という最重要項目に絞って確認する(片方だけ変更して同期を忘れた場合に
// 検知できるようにするため)。
//
// 実行方法: npm run test (tscでコンパイルしてから実行する。package.json参照)

import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateNotificationDecision, evaluateFloodRiskNotificationDecision } from "./notificationDecision";
import { notificationDecisionConfig, type NotificationDecisionConfig } from "./notificationDecisionConfig";

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
const GOOD_TOTAL_RAINFALL = { status: "evaluated" as const, totalPredictedRainfallMm: 150, windowHours: 24 };
const NO_PREVIOUS = { lastNotificationState: null, lastNotifiedAt: null };

test("【最重要】本番のnotificationDecisionConfig.enabledはfalseである", () => {
  assert.equal(notificationDecisionConfig.enabled, false);
});

test("evaluateNotificationDecision: enabled:falseなら条件を満たす入力でも必ずno_notification", () => {
  const result = evaluateNotificationDecision({
    staticFloodHazard: GOOD_HAZARD,
    rainfallForecast: GOOD_RAINFALL,
    dataCompleteness: "complete",
    previousNotificationState: NO_PREVIOUS,
    config: { ...ENABLED_CONFIG, enabled: false },
  });
  assert.equal(result.type, "no_notification");
});

test("evaluateNotificationDecision: enabled:trueかつ条件を満たせばcandidate", () => {
  const result = evaluateNotificationDecision({
    staticFloodHazard: GOOD_HAZARD,
    rainfallForecast: GOOD_RAINFALL,
    dataCompleteness: "complete",
    previousNotificationState: NO_PREVIOUS,
    config: ENABLED_CONFIG,
  });
  assert.equal(result.type, "candidate");
});

test("evaluateFloodRiskNotificationDecision: enabled:falseなら条件を満たす入力でも必ずno_notification", () => {
  const result = evaluateFloodRiskNotificationDecision({
    staticFloodHazard: GOOD_HAZARD,
    totalPredictedRainfall: GOOD_TOTAL_RAINFALL,
    dataCompleteness: "complete",
    previousNotificationState: NO_PREVIOUS,
    config: { ...ENABLED_CONFIG, enabled: false },
  });
  assert.equal(result.type, "no_notification");
});

test("evaluateFloodRiskNotificationDecision: enabled:trueかつ予測総雨量が閾値以上ならcandidate", () => {
  const result = evaluateFloodRiskNotificationDecision({
    staticFloodHazard: GOOD_HAZARD,
    totalPredictedRainfall: GOOD_TOTAL_RAINFALL,
    dataCompleteness: "complete",
    previousNotificationState: NO_PREVIOUS,
    config: ENABLED_CONFIG,
  });
  assert.equal(result.type, "candidate");
});

test("staticFloodHazard.status=unknownならinsufficient_data(unknownをoutside扱いしない、両判定共通)", () => {
  const legacy = evaluateNotificationDecision({
    staticFloodHazard: { status: "unknown", depthRank: 0 },
    rainfallForecast: GOOD_RAINFALL,
    dataCompleteness: "partial",
    previousNotificationState: NO_PREVIOUS,
    config: ENABLED_CONFIG,
  });
  const floodRisk = evaluateFloodRiskNotificationDecision({
    staticFloodHazard: { status: "unknown", depthRank: 0 },
    totalPredictedRainfall: GOOD_TOTAL_RAINFALL,
    dataCompleteness: "partial",
    previousNotificationState: NO_PREVIOUS,
    config: ENABLED_CONFIG,
  });
  assert.equal(legacy.type, "insufficient_data");
  assert.equal(floodRisk.type, "insufficient_data");
});
