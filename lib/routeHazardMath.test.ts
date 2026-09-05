// Phase 5A.2: ルートハザード評価の数値計算に関する不変条件テスト。
//
// 実行方法: node --test lib/routeHazardMath.test.ts
// （Node.js 24のTypeScriptネイティブ実行機能を利用。ビルド工程は不要）
//
// ネットワークやI/Oを一切使わず、lib/routeHazardMath.ts の純粋関数のみを検証する。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  haversineDistanceMeters,
  sampleRouteAtInterval,
  aggregateRouteHazardResults,
  type LatLng,
  type SamplePointResult,
} from "./routeHazardMath.ts";

const EPS = 1e-6; // 浮動小数点誤差の許容値（比率用）
const DIST_EPS = 0.05; // 距離(m)の許容誤差

// 実際のL1-Aルート相当の、曲がりのある折れ線（簡略版・4頂点で直角に2回曲がる）
const BENT_ROUTE: LatLng[] = [
  { lat: 34.6900, lng: 135.5000 },
  { lat: 34.6900, lng: 135.5010 }, // 東へ約92m
  { lat: 34.6910, lng: 135.5010 }, // 北へ約111m
  { lat: 34.6910, lng: 135.5020 }, // 東へ約92m
];

test("sampleRouteAtInterval: 累積距離は単調増加する", () => {
  const samples = sampleRouteAtInterval(BENT_ROUTE, 20);
  for (let i = 1; i < samples.length; i++) {
    assert.ok(
      samples[i].cumulativeDistanceMeters >= samples[i - 1].cumulativeDistanceMeters,
      `index ${i} で累積距離が減少している`
    );
  }
});

test("sampleRouteAtInterval: 最終サンプルの累積距離は、元のジオメトリの頂点間距離の合計と一致する", () => {
  let trueTotal = 0;
  for (let i = 0; i < BENT_ROUTE.length - 1; i++) {
    trueTotal += haversineDistanceMeters(BENT_ROUTE[i], BENT_ROUTE[i + 1]);
  }

  for (const interval of [10, 20, 30, 50, 100]) {
    const samples = sampleRouteAtInterval(BENT_ROUTE, interval);
    const lastCumulative = samples[samples.length - 1].cumulativeDistanceMeters;
    assert.ok(
      Math.abs(lastCumulative - trueTotal) < DIST_EPS,
      `interval=${interval}: 累積距離${lastCumulative} と 真の総距離${trueTotal} が一致しない`
    );
  }
});

test("sampleRouteAtInterval: サンプル間の道なり距離は指定間隔にほぼ等しい（最終区間を除く）", () => {
  const interval = 20;
  const samples = sampleRouteAtInterval(BENT_ROUTE, interval);
  for (let i = 0; i < samples.length - 2; i++) {
    // 最後の1区間だけは端数（interval未満）になりうるため除外
    const segLength = samples[i + 1].cumulativeDistanceMeters - samples[i].cumulativeDistanceMeters;
    assert.ok(Math.abs(segLength - interval) < DIST_EPS, `区間${i}の距離${segLength}がintervalと一致しない`);
  }
});

function makeResults(ranks: (number | "unknown")[]): SamplePointResult[] {
  return ranks.map((r) =>
    r === "unknown" ? { status: "unknown", reason: "no_tile" } : { status: "evaluated", rank: r as 0 | 1 | 2 | 3 | 4 | 5 }
  );
}

function makeSamples(cumulativeDistances: number[]): { point: LatLng; cumulativeDistanceMeters: number }[] {
  return cumulativeDistances.map((d) => ({ point: { lat: 0, lng: 0 }, cumulativeDistanceMeters: d }));
}

test("aggregateRouteHazardResults: 全区間評価済み・ハザードなしの場合、Coverage=100%・洪水割合=0", () => {
  const samples = makeSamples([0, 20, 40, 60]);
  const results = makeResults([0, 0, 0, 0]);
  const agg = aggregateRouteHazardResults(samples, results);

  assert.equal(agg.hazardEvaluationDistanceMeters, 60);
  assert.equal(agg.evaluatedDistanceMeters, 60);
  assert.equal(agg.unavailableDistanceMeters, 0);
  assert.equal(agg.evaluationCoverageRatio, 1);
  assert.equal(agg.floodCrossingDistanceMeters, 0);
  assert.equal(agg.floodCrossingRatioAmongEvaluatedDistance, 0);
  assert.equal(agg.maxDepthRank, 0);
});

test("aggregateRouteHazardResults: 全区間unknownの場合、Coverage=0・洪水割合はnull", () => {
  const samples = makeSamples([0, 20, 40]);
  const results = makeResults(["unknown", "unknown", "unknown"]);
  const agg = aggregateRouteHazardResults(samples, results);

  assert.equal(agg.evaluatedDistanceMeters, 0);
  assert.equal(agg.unavailableDistanceMeters, 40);
  assert.equal(agg.evaluationCoverageRatio, 0);
  assert.equal(agg.floodCrossingDistanceMeters, 0);
  assert.equal(agg.floodCrossingRatioAmongEvaluatedDistance, null);
});

test("aggregateRouteHazardResults: 一部区間のみハザード検出", () => {
  // 0-20: rank0/rank0 (clear), 20-40: rank0/rank2 (hazard), 40-60: rank2/rank0 (hazard)
  const samples = makeSamples([0, 20, 40, 60]);
  const results = makeResults([0, 0, 2, 0]);
  const agg = aggregateRouteHazardResults(samples, results);

  assert.equal(agg.evaluatedDistanceMeters, 60);
  assert.equal(agg.floodCrossingDistanceMeters, 40); // 20-40, 40-60の2区間
  assert.equal(agg.floodCrossingRatioAmongEvaluatedDistance, 40 / 60);
  assert.equal(agg.maxDepthRank, 2);
});

test("数学的不変条件（複数のランダムに近い入力パターンで検証）", () => {
  const patterns: (number | "unknown")[][] = [
    [0, 0, 0],
    [1, 2, 3, 0],
    ["unknown", 0, 1, "unknown", 2],
    ["unknown", "unknown"],
    [0],
    [5, 5, 5, 5, 5],
  ];

  for (const pattern of patterns) {
    const cumulative = pattern.map((_, i) => i * 25);
    const samples = makeSamples(cumulative);
    const results = makeResults(pattern);
    const agg = aggregateRouteHazardResults(samples, results);

    // 不変条件1: 各距離は非負
    assert.ok(agg.evaluatedDistanceMeters >= 0, "evaluatedDistanceMeters >= 0");
    assert.ok(agg.unavailableDistanceMeters >= 0, "unavailableDistanceMeters >= 0");
    assert.ok(agg.floodCrossingDistanceMeters >= 0, "floodCrossingDistanceMeters >= 0");

    // 不変条件2: 洪水区間距離は評価済み距離を超えない
    assert.ok(
      agg.floodCrossingDistanceMeters <= agg.evaluatedDistanceMeters + EPS,
      "floodCrossingDistanceMeters <= evaluatedDistanceMeters"
    );

    // 不変条件3: 評価済み + 未評価 = ハザード評価対象距離
    assert.ok(
      Math.abs(
        agg.evaluatedDistanceMeters + agg.unavailableDistanceMeters - agg.hazardEvaluationDistanceMeters
      ) < DIST_EPS,
      "evaluatedDistance + unavailableDistance ≒ hazardEvaluationDistance"
    );

    // 不変条件4: Coverageの計算式が一致する
    if (agg.hazardEvaluationDistanceMeters > 0) {
      const expectedCoverage = agg.evaluatedDistanceMeters / agg.hazardEvaluationDistanceMeters;
      assert.ok(Math.abs((agg.evaluationCoverageRatio ?? -1) - expectedCoverage) < EPS, "coverage計算式の一致");
    } else {
      assert.equal(agg.evaluationCoverageRatio, null);
    }

    // 不変条件5: floodCrossingRatioの計算式が一致する
    if (agg.evaluatedDistanceMeters > 0) {
      const expectedRatio = agg.floodCrossingDistanceMeters / agg.evaluatedDistanceMeters;
      assert.ok(
        Math.abs((agg.floodCrossingRatioAmongEvaluatedDistance ?? -1) - expectedRatio) < EPS,
        "floodCrossingRatio計算式の一致"
      );
    } else {
      assert.equal(agg.floodCrossingRatioAmongEvaluatedDistance, null);
    }

    // 不変条件6: Coverageが100%（誤差内）ならunavailableDistanceはほぼ0
    if (agg.evaluationCoverageRatio !== null && agg.evaluationCoverageRatio > 1 - EPS) {
      assert.ok(agg.unavailableDistanceMeters < DIST_EPS, "Coverage100%ならunavailableDistance≒0");
    }

    // 不変条件7: Coverageが0（誤差内）ならevaluatedDistanceはほぼ0
    if (agg.evaluationCoverageRatio !== null && agg.evaluationCoverageRatio < EPS) {
      assert.ok(agg.evaluatedDistanceMeters < DIST_EPS, "Coverage0%ならevaluatedDistance≒0");
    }

    // 不変条件8: 比率は0〜1の範囲
    if (agg.evaluationCoverageRatio !== null) {
      assert.ok(agg.evaluationCoverageRatio >= -EPS && agg.evaluationCoverageRatio <= 1 + EPS, "coverage in [0,1]");
    }
    if (agg.floodCrossingRatioAmongEvaluatedDistance !== null) {
      assert.ok(
        agg.floodCrossingRatioAmongEvaluatedDistance >= -EPS && agg.floodCrossingRatioAmongEvaluatedDistance <= 1 + EPS,
        "floodCrossingRatio in [0,1]"
      );
    }
  }
});
