// 試作3: lib/rainfallForecastOpenMeteo.ts の純粋関数(computeAccumulatedRainfall)の単体テスト。
// fetchHourlyPrecipitationForecast()自体はネットワークI/Oのためテスト対象外。

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAccumulatedRainfall, type HourlyPrecipitationPoint } from "./rainfallForecastOpenMeteo.ts";

function makeHourly(values: number[]): HourlyPrecipitationPoint[] {
  return values.map((v, i) => ({
    time: new Date(2026, 8, 8, i).toISOString(),
    precipitationMm: v,
  }));
}

test("computeAccumulatedRainfall: 3時間分を正しく積算する", () => {
  const hourly = makeHourly([2, 3, 5, 1, 0]);
  const result = computeAccumulatedRainfall(hourly, 180); // 3時間
  assert.ok(result);
  assert.equal(result!.rainfallMm, 10); // 2+3+5
  assert.equal(result!.hoursUsed, 3);
});

test("computeAccumulatedRainfall: データが不足している場合はnull（外挿しない）", () => {
  const hourly = makeHourly([2, 3]); // 2時間分しかない
  const result = computeAccumulatedRainfall(hourly, 360); // 6時間分要求
  assert.equal(result, null);
});

test("computeAccumulatedRainfall: 60の倍数でない時間幅はnull", () => {
  const hourly = makeHourly([2, 3, 5]);
  const result = computeAccumulatedRainfall(hourly, 90);
  assert.equal(result, null);
});

test("computeAccumulatedRainfall: 24時間分の積算ができる（データが十分にある場合）", () => {
  const hourly = makeHourly(new Array(24).fill(1));
  const result = computeAccumulatedRainfall(hourly, 24 * 60);
  assert.ok(result);
  assert.equal(result!.rainfallMm, 24);
  assert.equal(result!.hoursUsed, 24);
});

test("computeAccumulatedRainfall: 25時間分要求したがデータが24時間分しかない場合はnull", () => {
  const hourly = makeHourly(new Array(24).fill(1));
  const result = computeAccumulatedRainfall(hourly, 25 * 60);
  assert.equal(result, null);
});
