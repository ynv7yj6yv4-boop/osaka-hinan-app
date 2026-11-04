// lib/forecastRainfallRisk.ts と、buildRiskResult()への予想雨量の組み込みの単体テスト。
// （既存のlib/riskAssessment.test.tsは、予想雨量を渡さない従来の静的判定の仕様をそのまま検証している）

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeForecastRainfall,
  categorizeForecastRainfall,
  combineStaticAndForecast,
  type ForecastRainfallSummary,
} from "./forecastRainfallRisk.ts";
import { buildRiskResult } from "./riskAssessment.ts";
import { FORECAST_RULE_VERSION, RULE_VERSION } from "./judgmentLog.ts";
import { riskLevelToSwitchState } from "./myEvacuationSwitch.ts";
import type { HazardPixelStatus } from "./hazardPixelClassifier.ts";
import type { HourlyPrecipitationPoint } from "./rainfallForecastOpenMeteo.ts";

// --- summarizeForecastRainfall ---

/** 当日0時(JST)から hours 時間分の、Open-Meteo形式(オフセット無しJST)の1時間データ */
function hourlyFromMidnight(values: (number | null)[]): HourlyPrecipitationPoint[] {
  return values.map((v, i) => ({
    time: `${i < 24 ? "2026-11-04" : "2026-11-05"}T${String(i % 24).padStart(2, "0")}:00`,
    precipitationMm: v,
  }));
}

test("既に終わった時間帯（当日0時〜現在）を除き、今から先の時間だけを合計する", () => {
  // 0〜9時は10mmずつ（過去）、10時以降は1mmずつ
  const values = Array.from({ length: 48 }, (_, i) => (i < 10 ? 10 : 1));
  const hourly = hourlyFromMidnight(values);
  // 現在 JST 9:30 → 9:00終端(8〜9時)までは過去。10:00終端(9〜10時、進行中)から24時間分を使う
  const now = new Date("2026-11-04T09:30:00+09:00");
  const s = summarizeForecastRainfall(hourly, now, 24);
  assert.deepEqual(s, { totalMm: 24, maxHourlyMm: 1 });
});

test("最大1時間雨量を返す", () => {
  const values = Array.from({ length: 48 }, (_, i) => (i === 20 ? 35 : 0));
  const s = summarizeForecastRainfall(hourlyFromMidnight(values), new Date("2026-11-04T08:10:00+09:00"), 24);
  assert.equal(s?.maxHourlyMm, 35);
  assert.equal(s?.totalMm, 35);
});

test("欠測(null)が予想期間内にあれば0mmとみなさずnull", () => {
  const values = Array.from({ length: 48 }, (_, i) => (i === 15 ? null : 0));
  assert.equal(summarizeForecastRainfall(hourlyFromMidnight(values), new Date("2026-11-04T08:00:00+09:00"), 24), null);
});

test("予想期間に足りるデータが無ければ外挿せずnull", () => {
  const values = Array.from({ length: 24 }, () => 0);
  assert.equal(summarizeForecastRainfall(hourlyFromMidnight(values), new Date("2026-11-04T08:00:00+09:00"), 24), null);
});

// --- categorizeForecastRainfall ---

test("区分: 少ない / まとまった雨 / 大雨（合計・1時間最大のどちらかで判定）", () => {
  assert.equal(categorizeForecastRainfall({ totalMm: 10, maxHourlyMm: 5 }), "low");
  assert.equal(categorizeForecastRainfall({ totalMm: 50, maxHourlyMm: 5 }), "moderate");
  assert.equal(categorizeForecastRainfall({ totalMm: 10, maxHourlyMm: 20 }), "moderate");
  assert.equal(categorizeForecastRainfall({ totalMm: 100, maxHourlyMm: 5 }), "heavy");
  assert.equal(categorizeForecastRainfall({ totalMm: 30, maxHourlyMm: 30 }), "heavy");
  assert.equal(categorizeForecastRainfall({ totalMm: 49.9, maxHourlyMm: 19.9 }), "low");
});

// --- combineStaticAndForecast ---

test("組み合わせ表: 区域内でも雨が少なければ高リスクにしない（ただし低リスクにもしない）", () => {
  assert.equal(combineStaticAndForecast(0, "low"), "safe");
  assert.equal(combineStaticAndForecast(0, "moderate"), "safe");
  assert.equal(combineStaticAndForecast(0, "heavy"), "caution");
  assert.equal(combineStaticAndForecast(1, "low"), "caution");
  assert.equal(combineStaticAndForecast(1, "moderate"), "caution");
  assert.equal(combineStaticAndForecast(1, "heavy"), "prepare");
  assert.equal(combineStaticAndForecast(2, "low"), "caution");
  assert.equal(combineStaticAndForecast(2, "moderate"), "prepare");
  assert.equal(combineStaticAndForecast(5, "heavy"), "prepare");
});

test("どの組み合わせでもevacuate(最高リスク)には到達しない（既存方針の維持）", () => {
  for (const rank of [0, 1, 2, 3, 4, 5])
    for (const c of ["low", "moderate", "heavy"] as const) assert.notEqual(combineStaticAndForecast(rank, c), "evacuate");
});

// --- buildRiskResult への組み込み ---

const BASE = {
  lat: 34.6937,
  lng: 135.5023,
  elevation: { available: false } as const,
  rainfall: { status: "fetch_error", fetchedAt: "2026-11-04T00:00:00.000Z" } as const,
};
const DEEP: HazardPixelStatus = { status: "hazard", rank: 3 };
const UNKNOWN: HazardPixelStatus = { status: "unknown", reason: "no_tile" };
const forecast = (totalMm: number, maxHourlyMm: number): ForecastRainfallSummary => ({
  status: "evaluated",
  totalMm,
  maxHourlyMm,
  windowHours: 24,
  fetchedAt: "2026-11-04T00:00:00.000Z",
  source: "open-meteo-jma-msm",
});
const UNAVAILABLE: ForecastRainfallSummary = {
  status: "unavailable",
  fetchedAt: "2026-11-04T00:00:00.000Z",
  source: "open-meteo-jma-msm",
};

test("晴天（予想雨量が少ない）なら、深い浸水想定区域でも注意にとどまり、マイ避難スイッチはONにならない", () => {
  const r = buildRiskResult({ ...BASE, hazardPixels: [DEEP], forecastRainfall: forecast(0, 0) });
  assert.equal(r.level, "caution");
  assert.equal(r.levelBasis, "static_and_forecast");
  assert.equal(riskLevelToSwitchState(r.level), "prepare");
  assert.match(r.recommendation, /大雨は予想されていません/);
});

test("浸水想定区域内でまとまった雨が予想されれば高リスク（スイッチON）", () => {
  const r = buildRiskResult({ ...BASE, hazardPixels: [DEEP], forecastRainfall: forecast(80, 12) });
  assert.equal(r.level, "prepare");
  assert.equal(riskLevelToSwitchState(r.level), "on");
  assert.ok(r.reasons.some((x) => x.includes("約80mm")));
});

test("予想雨量を取得できなければ従来どおり静的ハザードのみで判定（レベルを引き下げない）", () => {
  const r = buildRiskResult({ ...BASE, hazardPixels: [DEEP], forecastRainfall: UNAVAILABLE });
  assert.equal(r.level, "prepare");
  assert.equal(r.levelBasis, "static_only");
  assert.ok(r.disclaimers.some((d) => d.includes("予想雨量を取得できなかった")));
  assert.equal(r.judgmentLog.ruleVersion, RULE_VERSION);
});

test("静的ハザードがunknownなら、大雨予想があってもunknownのまま（雨量だけでlevelを決めない）", () => {
  const r = buildRiskResult({ ...BASE, hazardPixels: [UNKNOWN], forecastRainfall: forecast(200, 50) });
  assert.equal(r.level, "unknown");
  assert.equal(r.levelBasis, "static_only");
});

test("予想雨量を使った判定は研究ログに記録され、ルールのバージョンが分かれる", () => {
  const r = buildRiskResult({ ...BASE, hazardPixels: [DEEP], forecastRainfall: forecast(120, 35) });
  assert.equal(r.judgmentLog.ruleVersion, FORECAST_RULE_VERSION);
  assert.equal(r.judgmentLog.forecastRainfall?.category, "heavy");
  assert.equal(r.judgmentLog.forecastRainfall?.usedInJudgment, true);
});

test("予想雨量を渡さない場合はforecastRainfall=null・従来の静的判定", () => {
  const r = buildRiskResult({ ...BASE, hazardPixels: [DEEP] });
  assert.equal(r.forecastRainfall, null);
  assert.equal(r.levelBasis, "static_only");
  assert.equal(r.level, "prepare");
});

test("推奨行動・注意書きに断定的な避難指示を含めない", () => {
  for (const [hp, f] of [
    [DEEP, forecast(0, 0)],
    [DEEP, forecast(150, 40)],
    [{ status: "outside" } as HazardPixelStatus, forecast(150, 40)],
  ] as const) {
    const r = buildRiskResult({ ...BASE, hazardPixels: [hp], forecastRainfall: f });
    assert.doesNotMatch(r.recommendation + r.disclaimers.join(""), /避難してください|必ず避難|安全です/);
  }
});
