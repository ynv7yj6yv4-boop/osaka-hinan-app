// 試作3: lib/notificationExperimentMetrics.ts の単体テスト。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitIntoRainfallEvents,
  computeExperimentMetrics,
  type RainfallHourPoint,
  type MethodDecisionRecord,
} from "./notificationExperimentMetrics.ts";

function hours(values: (number | null)[]): RainfallHourPoint[] {
  return values.map((v, i) => ({ time: `2026-09-08T${String(i).padStart(2, "0")}:00:00.000Z`, precipitationMm: v }));
}

test("splitIntoRainfallEvents: 十分な無降雨時間で2つのイベントに分割される", () => {
  // 雨(2h) → 無降雨6h(IETD=6) → 雨(1h)
  const data = hours([5, 3, 0, 0, 0, 0, 0, 0, 8]);
  const events = splitIntoRainfallEvents(data, 6);
  assert.equal(events.length, 2);
  assert.equal(events[0].peakHourlyRainfallMm, 5);
  assert.equal(events[1].peakHourlyRainfallMm, 8);
});

test("splitIntoRainfallEvents: 無降雨時間がIETD未満なら1つのイベントのまま", () => {
  const data = hours([5, 0, 0, 8]); // 無降雨2h < IETD6h
  const events = splitIntoRainfallEvents(data, 6);
  assert.equal(events.length, 1);
  assert.equal(events[0].peakHourlyRainfallMm, 8);
});

test("splitIntoRainfallEvents: 欠測(null)はイベントを分断しない", () => {
  const data = hours([5, null, null, 3]); // 欠測中は「継続中」とみなす
  const events = splitIntoRainfallEvents(data, 6);
  assert.equal(events.length, 1);
});

test("computeExperimentMetrics: 各指標を正しく計算する", () => {
  const records: MethodDecisionRecord[] = [
    { timestamp: "2026-09-08T00:00:00.000Z", isCandidate: true, rainCondition: "met" },
    { timestamp: "2026-09-08T01:00:00.000Z", isCandidate: false, rainCondition: "not_met" },
    { timestamp: "2026-09-08T02:00:00.000Z", isCandidate: false, rainCondition: "insufficient_data" },
  ];
  const events = splitIntoRainfallEvents(hours([5, 0, 0, 0, 0, 0, 0]), 6);

  const metrics = computeExperimentMetrics({
    records,
    baselineCandidateCount: 2,
    events,
    weakRainPeakThresholdMm: 10,
    rainyDayCount: 1,
  });

  assert.equal(metrics.totalCandidates, 1);
  assert.equal(metrics.insufficientDataCount, 1);
  assert.equal(metrics.notificationCandidatesPerRainyDay, 1);
  assert.equal(metrics.duplicateSuppressionRate, 1 - 1 / 2);
});

test("computeExperimentMetrics: baselineが0ならduplicateSuppressionRateはnull", () => {
  const metrics = computeExperimentMetrics({
    records: [],
    baselineCandidateCount: 0,
    events: [],
    weakRainPeakThresholdMm: null,
    rainyDayCount: 0,
  });
  assert.equal(metrics.duplicateSuppressionRate, null);
  assert.equal(metrics.notificationCandidatesPerRainyDay, null);
  assert.equal(metrics.notifiedEventRatio, null);
});
