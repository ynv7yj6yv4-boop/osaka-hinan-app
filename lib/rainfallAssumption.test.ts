// 試作3: lib/rainfallAssumption.ts の単体テスト。

import { test } from "node:test";
import assert from "node:assert/strict";
import { compareRainfallToAssumption, type ForecastRainfallWindow } from "./rainfallAssumption.ts";

const SAMPLE_FORECAST: ForecastRainfallWindow = {
  forecastBaseTime: "2026-09-08T00:00:00.000Z",
  forecastValidTime: "2026-09-09T00:00:00.000Z",
  leadTimeMinutes: 1440,
  rainfallMm: 50,
  accumulationWindowMinutes: 1440,
  spatialResolution: "jma-msm-0.05deg",
  source: "open-meteo-jma-msm",
};

test("想定降雨条件がnull(未特定)ならnot_comparable(assumption_unavailable)", () => {
  const result = compareRainfallToAssumption(null, SAMPLE_FORECAST);
  assert.equal(result.status, "not_comparable");
  if (result.status === "not_comparable") assert.equal(result.reason, "assumption_unavailable");
});

test("継続時間が一致しない場合はnot_comparable(duration_mismatch)", () => {
  const result = compareRainfallToAssumption(
    { totalRainfallMm: 300, durationHours: 48, spatialDefinition: "point", riverOrBasin: "テスト川", source: "test" },
    SAMPLE_FORECAST // 24時間(1440分)
  );
  assert.equal(result.status, "not_comparable");
  if (result.status === "not_comparable") assert.equal(result.reason, "duration_mismatch");
});

test("流域平均雨量の想定に対しては地点予報を単純比較しない(spatial_definition_mismatch)", () => {
  const result = compareRainfallToAssumption(
    {
      totalRainfallMm: 300,
      durationHours: 24,
      spatialDefinition: "basin-average",
      riverOrBasin: "テスト川",
      source: "test",
    },
    SAMPLE_FORECAST
  );
  assert.equal(result.status, "not_comparable");
  if (result.status === "not_comparable") assert.equal(result.reason, "spatial_definition_mismatch");
});

test("継続時間・空間定義が一致すればcomparableになり、参考指標を計算する", () => {
  const result = compareRainfallToAssumption(
    { totalRainfallMm: 250, durationHours: 24, spatialDefinition: "point", riverOrBasin: "テスト川", source: "test" },
    SAMPLE_FORECAST
  );
  assert.equal(result.status, "comparable");
  if (result.status === "comparable") {
    assert.equal(result.rainfallProgressRatio, 50 / 250);
  }
});
