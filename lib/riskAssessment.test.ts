// lib/riskAssessment.ts の単体テスト。
//
// 【このテストの目的】現在の仕様を固定するためのテストであり、
// 仕様を変更するために書いたものではない。特に以下の既存ルールは
// このテストで変更せず、そのまま検証する:
// - 降雨情報(rainfall)はスコア・levelに一切影響しない(参考表示のみ)
// - 404等(unknown)は「区域外」「低リスク」とみなさない
// - Phase3時点では🔴(evacuate)は使用しない(スコアが高くても🟠が上限)
//
// buildRiskResult()はassessRisk()からネットワークI/Oを除いた純粋関数
// (依存性注入)のため、実際のタイル取得を行わずに判定ロジックだけを検証できる。

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRiskResult } from "./riskAssessment.ts";
import type { HazardPixelStatus } from "./hazardPixelClassifier.ts";
import type { ElevationResult } from "./elevation.ts";
import type { RainfallObservationResult } from "./rainfallObservation.ts";

const OUTSIDE: HazardPixelStatus = { status: "outside" };
const HAZARD_RANK_1: HazardPixelStatus = { status: "hazard", rank: 1 };
const HAZARD_RANK_3: HazardPixelStatus = { status: "hazard", rank: 3 };
const UNKNOWN_NO_TILE: HazardPixelStatus = { status: "unknown", reason: "no_tile" };
const UNKNOWN_FETCH_ERROR: HazardPixelStatus = { status: "unknown", reason: "fetch_error" };
const UNKNOWN_COLOR: HazardPixelStatus = { status: "unknown", reason: "color_unknown" };

const NO_ELEVATION: ElevationResult = { available: false };
const NO_RAINFALL: RainfallObservationResult = { status: "fetch_error", fetchedAt: "2026-09-10T00:00:00.000Z" };
const OBSERVED_HEAVY_RAINFALL: RainfallObservationResult = {
  status: "observed",
  dataTimeLabel: "12:00",
  fetchedAt: "2026-09-10T03:00:00.000Z",
  rank: 8,
  approxRange: "80mm/h以上程度（猛烈な雨）",
};

const BASE = { lat: 34.6937, lng: 135.5023, elevation: NO_ELEVATION, rainfall: NO_RAINFALL };

// --- 洪水リスクあり / 内水氾濫リスクあり / 両方 / リスクなし ---

test("洪水のみhazard(区域内)なら level=prepare または caution になり、洪水の情報が反映される", () => {
  const result = buildRiskResult({ ...BASE, hazardPixels: [HAZARD_RANK_1, OUTSIDE] });
  assert.equal(result.score, 1);
  assert.equal(result.level, "caution");
  assert.equal(result.assessmentCompleteness, "complete");
  const flood = result.factors.find((f) => f.key === "flood");
  assert.equal(flood?.available, true);
  assert.match(flood!.detail, /浸水想定区域内/);
});

test("内水氾濫のみhazard(区域内)なら内水氾濫の情報が反映される", () => {
  const result = buildRiskResult({ ...BASE, hazardPixels: [OUTSIDE, HAZARD_RANK_1] });
  const inundation = result.factors.find((f) => f.key === "inundation");
  assert.equal(inundation?.available, true);
  assert.match(inundation!.detail, /浸水想定区域内/);
  assert.equal(result.score, 1);
});

test("洪水・内水氾濫の両方がhazardなら、スコアはより高い方(maxRank)が採用される", () => {
  const result = buildRiskResult({ ...BASE, hazardPixels: [HAZARD_RANK_1, HAZARD_RANK_3] });
  assert.equal(result.score, 3);
  assert.equal(result.level, "prepare");
  assert.equal(result.assessmentCompleteness, "complete");
});

test("両方ともoutside(区域外)ならリスクなし(safe)、スコア0", () => {
  const result = buildRiskResult({ ...BASE, hazardPixels: [OUTSIDE, OUTSIDE] });
  assert.equal(result.score, 0);
  assert.equal(result.level, "safe");
  assert.equal(result.assessmentCompleteness, "complete");
});

// --- ハザード情報が取得できない場合 ---

test("両方ともunknownなら assessmentCompleteness=unavailable, level=unknown(safeにはしない)", () => {
  const result = buildRiskResult({ ...BASE, hazardPixels: [UNKNOWN_NO_TILE, UNKNOWN_FETCH_ERROR] });
  assert.equal(result.assessmentCompleteness, "unavailable");
  assert.equal(result.level, "unknown");
  assert.equal(result.score, 0);
});

test("片方がunknownでもpartialとなり、判定できた方の情報でlevelを決める(unknownで既知リスクを引き下げない)", () => {
  const result = buildRiskResult({ ...BASE, hazardPixels: [HAZARD_RANK_3, UNKNOWN_NO_TILE] });
  assert.equal(result.assessmentCompleteness, "partial");
  assert.equal(result.score, 3);
  assert.equal(result.level, "prepare");
  assert.ok(
    result.disclaimers.some((d) => d.includes("一部について")),
    "partial時は一部確認できなかった旨のdisclaimerが追加される"
  );
});

// --- 404等をunknownとして扱う既存仕様(区域外・低リスクへの変換禁止) ---

test("no_tile(404相当)はunknownのまま保持され、outsideや低リスクへ変換されない", () => {
  const result = buildRiskResult({ ...BASE, hazardPixels: [UNKNOWN_NO_TILE, UNKNOWN_NO_TILE] });
  const flood = result.factors.find((f) => f.key === "flood");
  assert.equal(flood?.status, "unknown");
  assert.equal(flood?.reason, "no_tile");
  assert.equal(flood?.available, false);
  assert.notEqual(result.level, "safe");
  assert.equal(result.level, "unknown");
});

// --- API/タイル取得エラー ---

test("fetch_error理由のunknownも同様にunknownとして扱われる(理由の違いで結果を変えない)", () => {
  const result = buildRiskResult({ ...BASE, hazardPixels: [UNKNOWN_FETCH_ERROR, UNKNOWN_FETCH_ERROR] });
  assert.equal(result.assessmentCompleteness, "unavailable");
  assert.equal(result.level, "unknown");
});

test("color_unknown理由のunknownも同様に扱われる", () => {
  const result = buildRiskResult({ ...BASE, hazardPixels: [UNKNOWN_COLOR, OUTSIDE] });
  assert.equal(result.assessmentCompleteness, "partial");
  const flood = result.factors.find((f) => f.key === "flood");
  assert.equal(flood?.reason, "color_unknown");
});

// --- 境界値・RiskLevel判定ロジック(scoreToLevel相当) ---

test("境界値: score=0はsafe", () => {
  const result = buildRiskResult({ ...BASE, hazardPixels: [OUTSIDE, OUTSIDE] });
  assert.equal(result.score, 0);
  assert.equal(result.level, "safe");
});

test("境界値: score=1(ちょうど)はcaution", () => {
  const result = buildRiskResult({ ...BASE, hazardPixels: [HAZARD_RANK_1, OUTSIDE] });
  assert.equal(result.score, 1);
  assert.equal(result.level, "caution");
});

test("境界値: score=2以上はすべてprepare(rank=5でも🔴evacuateにはならない)", () => {
  const rank5: HazardPixelStatus = { status: "hazard", rank: 5 };
  const result = buildRiskResult({ ...BASE, hazardPixels: [rank5, OUTSIDE] });
  assert.equal(result.score, 5);
  assert.equal(result.level, "prepare");
  assert.notEqual(result.level, "evacuate");
});

test("現時点の仕様ではevacuate(🔴)には一切到達しない(rank/rainfallの組み合わせを変えても)", () => {
  const rank5: HazardPixelStatus = { status: "hazard", rank: 5 };
  const result = buildRiskResult({
    lat: 34.6937,
    lng: 135.5023,
    hazardPixels: [rank5, rank5],
    elevation: NO_ELEVATION,
    rainfall: OBSERVED_HEAVY_RAINFALL, // 猛烈な雨(rank8)でも
  });
  assert.notEqual(result.level, "evacuate");
  assert.equal(result.level, "prepare");
});

// --- 降雨情報はまだ判定に反映されない、という既存仕様の固定 ---

test("降雨実況が「観測あり・猛烈な雨」でも、静的ハザードが区域外ならlevelはsafeのまま変わらない", () => {
  const withHeavyRain = buildRiskResult({
    lat: 34.6937,
    lng: 135.5023,
    hazardPixels: [OUTSIDE, OUTSIDE],
    elevation: NO_ELEVATION,
    rainfall: OBSERVED_HEAVY_RAINFALL,
  });
  const withoutRain = buildRiskResult({ ...BASE, hazardPixels: [OUTSIDE, OUTSIDE] });
  assert.equal(withHeavyRain.level, withoutRain.level);
  assert.equal(withHeavyRain.score, withoutRain.score);
  assert.equal(withHeavyRain.level, "safe");
});

test("降雨実況の取得失敗(fetch_error)でも、静的ハザード判定(score/level)には一切影響しない", () => {
  const result = buildRiskResult({ ...BASE, hazardPixels: [HAZARD_RANK_3, OUTSIDE], rainfall: NO_RAINFALL });
  assert.equal(result.score, 3);
  assert.equal(result.level, "prepare");
  const rainfallFactor = result.factors.find((f) => f.key === "rainfall");
  assert.equal(rainfallFactor?.available, false);
  assert.equal(rainfallFactor?.score, 0, "rainfallのRiskFactor.scoreは常に0(総合スコアに寄与しない)");
});

test("降雨実況が観測できても、そのRiskFactor.scoreは常に0(反映しない既存仕様)", () => {
  const result = buildRiskResult({ ...BASE, hazardPixels: [OUTSIDE, OUTSIDE], rainfall: OBSERVED_HEAVY_RAINFALL });
  const rainfallFactor = result.factors.find((f) => f.key === "rainfall");
  assert.equal(rainfallFactor?.available, true);
  assert.equal(rainfallFactor?.score, 0);
});

// --- 標高(elevation)も判定スコアに影響しないことの確認 ---

test("標高が取得できてもできなくても、score/levelには影響しない", () => {
  const withElevation = buildRiskResult({
    ...BASE,
    hazardPixels: [HAZARD_RANK_1, OUTSIDE],
    elevation: { available: true, elevation: 3.4, source: "5m" },
  });
  const withoutElevation = buildRiskResult({ ...BASE, hazardPixels: [HAZARD_RANK_1, OUTSIDE] });
  assert.equal(withElevation.score, withoutElevation.score);
  assert.equal(withElevation.level, withoutElevation.level);
});

// --- その他の既存仕様の確認 ---

test("judgmentLogのruleVersion・positionが結果に含まれる(研究再現性のためのログ)", () => {
  const result = buildRiskResult({ ...BASE, hazardPixels: [HAZARD_RANK_1, OUTSIDE] });
  assert.equal(result.judgmentLog.position.lat, BASE.lat);
  assert.equal(result.judgmentLog.position.lng, BASE.lng);
  assert.ok(result.judgmentLog.ruleVersion.length > 0);
});

test("generatedAtを指定すればその値がそのまま使われる(再現性のための依存性注入)", () => {
  const result = buildRiskResult({
    ...BASE,
    hazardPixels: [OUTSIDE, OUTSIDE],
    generatedAt: "2026-09-10T00:00:00.000Z",
  });
  assert.equal(result.generatedAt, "2026-09-10T00:00:00.000Z");
});

test("disclaimersには常に基本の2件が含まれる(公式情報ではない旨・降雨未反映の旨)", () => {
  const result = buildRiskResult({ ...BASE, hazardPixels: [OUTSIDE, OUTSIDE] });
  assert.ok(result.disclaimers.some((d) => d.includes("公式の避難情報ではありません")));
  assert.ok(result.disclaimers.some((d) => d.includes("反映していません")));
});
