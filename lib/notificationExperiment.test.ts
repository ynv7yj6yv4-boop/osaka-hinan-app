// 試作3: lib/notificationExperiment.ts の単体テスト。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accumulateRainfall,
  maxHourlyRainfall,
  hashForecastContent,
  checkRainCondition,
  checkForecastInternalPersistence,
  hasForecastChanged,
  initialNotificationPointState,
  evaluateMethod,
  type ForecastRunSnapshot,
  type NotificationExperimentConfig,
} from "./notificationExperiment.ts";

const CONFIG: NotificationExperimentConfig = {
  configId: "test-v0",
  hourlyRainfallThresholdMm: 10,
  accumulated3hThresholdMm: 20,
  accumulated6hThresholdMm: 30,
  requiredConsecutiveForecastHours: 2,
  requiredConsecutiveRuns: 2,
};

function snapshot(hourly: (number | null)[], fetchedAt = "2026-09-08T00:00:00.000Z"): ForecastRunSnapshot {
  return { fetchedAt, hourlyRainfallMm: hourly, contentHash: hashForecastContent(hourly) };
}

// --- accumulateRainfall / maxHourlyRainfall ---

test("accumulateRainfall: 欠測が無ければ正しく積算する", () => {
  assert.equal(accumulateRainfall([1, 2, 3, 4, 5, 6], 3), 6);
});

test("accumulateRainfall: 欠測が1つでもあればnull(外挿しない)", () => {
  assert.equal(accumulateRainfall([1, null, 3], 3), null);
});

test("accumulateRainfall: 配列が要求時間数に満たなければnull", () => {
  assert.equal(accumulateRainfall([1, 2], 3), null);
});

test("maxHourlyRainfall: 最大値を正しく返す", () => {
  assert.equal(maxHourlyRainfall([1, 8, 3], 3), 8);
});

// --- hashForecastContent ---

test("hashForecastContent: 同じ内容は同じハッシュ、異なる内容は異なるハッシュ", () => {
  const h1 = hashForecastContent([1, 2, 3]);
  const h2 = hashForecastContent([1, 2, 3]);
  const h3 = hashForecastContent([1, 2, 4]);
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
});

// --- checkRainCondition ---

test("checkRainCondition: いずれの閾値も満たさなければnot_met", () => {
  const result = checkRainCondition(snapshot([1, 1, 1, 1, 1, 1]), CONFIG);
  assert.equal(result, "not_met");
});

test("checkRainCondition: 1時間値が閾値以上ならmet", () => {
  const result = checkRainCondition(snapshot([15, 0, 0, 0, 0, 0]), CONFIG);
  assert.equal(result, "met");
});

test("checkRainCondition: 全て欠測ならinsufficient_data", () => {
  const result = checkRainCondition(snapshot([null, null, null, null, null, null]), CONFIG);
  assert.equal(result, "insufficient_data");
});

// --- checkForecastInternalPersistence ---

test("checkForecastInternalPersistence: 連続時間数が閾値以上ならtrue", () => {
  const result = checkForecastInternalPersistence(snapshot([12, 11, 0, 0, 0, 0]), CONFIG);
  assert.equal(result, true);
});

test("checkForecastInternalPersistence: 連続していなければfalse", () => {
  const result = checkForecastInternalPersistence(snapshot([12, 0, 12, 0, 0, 0]), CONFIG);
  assert.equal(result, false);
});

// --- hasForecastChanged ---

test("hasForecastChanged: 同一内容ならfalse", () => {
  const s = snapshot([1, 2, 3]);
  const state = { internalState: "normal" as const, persistence: { consecutiveRunsMatched: 0, lastEvaluatedContentHash: s.contentHash } };
  assert.equal(hasForecastChanged(s, state), false);
});

// --- evaluateMethod: Method1 (rain_only) ---

test("Method1(rain_only): ハザードに関わらず降雨条件だけでcandidateになる", () => {
  const result = evaluateMethod("rain_only", {
    staticFloodHazardStatus: "outside",
    forecast: snapshot([15, 0, 0, 0, 0, 0]),
    previousState: initialNotificationPointState(),
    config: CONFIG,
  });
  assert.equal(result.isCandidate, true);
});

// --- evaluateMethod: Method2 (hazard_and_rain) ---

test("Method2: hazard区域外なら候補にならない", () => {
  const result = evaluateMethod("hazard_and_rain", {
    staticFloodHazardStatus: "outside",
    forecast: snapshot([15, 0, 0, 0, 0, 0]),
    previousState: initialNotificationPointState(),
    config: CONFIG,
  });
  assert.equal(result.isCandidate, false);
});

test("Method2: hazard区域内+降雨条件成立なら候補になる(状態変化を見ない)", () => {
  const result = evaluateMethod("hazard_and_rain", {
    staticFloodHazardStatus: "hazard",
    forecast: snapshot([15, 0, 0, 0, 0, 0]),
    previousState: initialNotificationPointState(),
    config: CONFIG,
  });
  assert.equal(result.isCandidate, true);
});

test("Method2: unknownならinsufficient_data相当で候補にならない", () => {
  const result = evaluateMethod("hazard_and_rain", {
    staticFloodHazardStatus: "unknown",
    forecast: snapshot([15, 0, 0, 0, 0, 0]),
    previousState: initialNotificationPointState(),
    config: CONFIG,
  });
  assert.equal(result.isCandidate, false);
  assert.match(result.reason, /unknown/);
});

// --- evaluateMethod: Method3 (state_change) ---

test("Method3: 初回でnormal→candidateへ上昇した時だけ候補になる", () => {
  const first = evaluateMethod("hazard_rain_state_change", {
    staticFloodHazardStatus: "hazard",
    forecast: snapshot([15, 0, 0, 0, 0, 0]),
    previousState: initialNotificationPointState(),
    config: CONFIG,
  });
  assert.equal(first.isCandidate, true);

  // 同じ状態が続く2回目は候補にならない(重複通知抑制)
  const second = evaluateMethod("hazard_rain_state_change", {
    staticFloodHazardStatus: "hazard",
    forecast: snapshot([16, 0, 0, 0, 0, 0], "2026-09-08T01:00:00.000Z"),
    previousState: first.updatedState,
    config: CONFIG,
  });
  assert.equal(second.isCandidate, false);
});

test("Method3: 状態が低下した場合は候補にならない(ログには記録される)", () => {
  const first = evaluateMethod("hazard_rain_state_change", {
    staticFloodHazardStatus: "hazard",
    forecast: snapshot([15, 0, 0, 0, 0, 0]),
    previousState: initialNotificationPointState(),
    config: CONFIG,
  });
  const dropped = evaluateMethod("hazard_rain_state_change", {
    staticFloodHazardStatus: "hazard",
    forecast: snapshot([0, 0, 0, 0, 0, 0], "2026-09-08T01:00:00.000Z"),
    previousState: first.updatedState,
    config: CONFIG,
  });
  assert.equal(dropped.isCandidate, false);
  assert.equal(dropped.newInternalState, "normal");
});

// --- evaluateMethod: Method4 (persistence) ---

test("Method4: forecast内継続性が満たされればconfirmedへ到達し候補になる", () => {
  const result = evaluateMethod("hazard_rain_state_change_persistence", {
    staticFloodHazardStatus: "hazard",
    forecast: snapshot([12, 11, 0, 0, 0, 0]), // 連続2時間、CONFIG.requiredConsecutiveForecastHours=2
    previousState: initialNotificationPointState(),
    config: CONFIG,
  });
  assert.equal(result.newInternalState, "candidate_confirmed");
  assert.equal(result.isCandidate, true);
});

test("Method4: 継続性が未確認ならunconfirmedのまま候補にならない", () => {
  const result = evaluateMethod("hazard_rain_state_change_persistence", {
    staticFloodHazardStatus: "hazard",
    forecast: snapshot([15, 0, 0, 0, 0, 0]), // 単発。連続性なし、run間もまだ1回目
    previousState: initialNotificationPointState(),
    config: CONFIG,
  });
  assert.equal(result.newInternalState, "candidate_unconfirmed");
  assert.equal(result.isCandidate, false);
});

test("Method4: run間継続性(2回連続)でconfirmedへ到達する", () => {
  const first = evaluateMethod("hazard_rain_state_change_persistence", {
    staticFloodHazardStatus: "hazard",
    forecast: snapshot([15, 0, 0, 0, 0, 0], "2026-09-08T00:00:00.000Z"),
    previousState: initialNotificationPointState(),
    config: CONFIG,
  });
  assert.equal(first.isCandidate, false); // 1回目はunconfirmed

  const second = evaluateMethod("hazard_rain_state_change_persistence", {
    staticFloodHazardStatus: "hazard",
    forecast: snapshot([16, 0, 0, 0, 0, 0], "2026-09-08T03:00:00.000Z"), // 内容が変わり別run扱い
    previousState: first.updatedState,
    config: CONFIG,
  });
  assert.equal(second.newInternalState, "candidate_confirmed");
  assert.equal(second.isCandidate, true);
});

test("Method4: confirmedが継続している間は再通知しない", () => {
  const first = evaluateMethod("hazard_rain_state_change_persistence", {
    staticFloodHazardStatus: "hazard",
    forecast: snapshot([12, 11, 0, 0, 0, 0], "2026-09-08T00:00:00.000Z"),
    previousState: initialNotificationPointState(),
    config: CONFIG,
  });
  assert.equal(first.isCandidate, true);

  const second = evaluateMethod("hazard_rain_state_change_persistence", {
    staticFloodHazardStatus: "hazard",
    forecast: snapshot([13, 12, 0, 0, 0, 0], "2026-09-08T03:00:00.000Z"),
    previousState: first.updatedState,
    config: CONFIG,
  });
  assert.equal(second.isCandidate, false);
});

test("同一内容のforecast(重複evaluation)ではrun間継続カウントを進めない", () => {
  const s = snapshot([15, 0, 0, 0, 0, 0]);
  const first = evaluateMethod("hazard_rain_state_change_persistence", {
    staticFloodHazardStatus: "hazard",
    forecast: s,
    previousState: initialNotificationPointState(),
    config: CONFIG,
  });
  const duplicate = evaluateMethod("hazard_rain_state_change_persistence", {
    staticFloodHazardStatus: "hazard",
    forecast: s, // 全く同じ内容(同一ハッシュ)
    previousState: first.updatedState,
    config: CONFIG,
  });
  assert.equal(duplicate.updatedState.persistence.consecutiveRunsMatched, first.updatedState.persistence.consecutiveRunsMatched);
});
