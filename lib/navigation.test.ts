// 試作3 PART A: lib/navigation.ts の純粋関数に対する単体テスト。
// ネットワーク・ブラウザAPIには依存しない（既存のrouteHazardMath.test.tsと同じ方針）。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRoutePoints,
  findNearestPointOnRoute,
  findUpcomingStep,
  describeStep,
  initialOffRouteState,
  updateOffRouteState,
  hasArrivedNearDestination,
  OFF_ROUTE_BASE_METERS,
  OFF_ROUTE_CONSECUTIVE_READINGS,
  ARRIVAL_BASE_METERS,
} from "./navigation.ts";
import type { RouteStep } from "./evacuationRoute.ts";

test("buildRoutePoints: 累積距離は単調増加し、始点は0", () => {
  const geometry = [
    { lat: 34.6937, lng: 135.5023 },
    { lat: 34.694, lng: 135.503 },
    { lat: 34.6945, lng: 135.5035 },
  ];
  const points = buildRoutePoints(geometry);
  assert.equal(points[0].cumulativeDistanceMeters, 0);
  for (let i = 1; i < points.length; i++) {
    assert.ok(points[i].cumulativeDistanceMeters >= points[i - 1].cumulativeDistanceMeters);
  }
});

test("findNearestPointOnRoute: ルート上の点そのものを渡すと距離はほぼ0", () => {
  const geometry = [
    { lat: 34.6937, lng: 135.5023 },
    { lat: 34.7, lng: 135.51 },
  ];
  const points = buildRoutePoints(geometry);
  const midpoint = { lat: (34.6937 + 34.7) / 2, lng: (135.5023 + 135.51) / 2 };
  const result = findNearestPointOnRoute(midpoint, points);
  assert.ok(result);
  assert.ok(result!.distanceFromRouteMeters < 1);
});

test("findNearestPointOnRoute: ルートから明らかに離れた地点は距離が大きい", () => {
  const geometry = [
    { lat: 34.6937, lng: 135.5023 },
    { lat: 34.7, lng: 135.51 },
  ];
  const points = buildRoutePoints(geometry);
  // ルートから東へ大きくずれた地点
  const farPoint = { lat: 34.6968, lng: 135.53 };
  const result = findNearestPointOnRoute(farPoint, points);
  assert.ok(result);
  assert.ok(result!.distanceFromRouteMeters > 1000);
});

test("findNearestPointOnRoute: 残り距離はルート総距離を超えない", () => {
  const geometry = [
    { lat: 34.6937, lng: 135.5023 },
    { lat: 34.694, lng: 135.503 },
    { lat: 34.6945, lng: 135.5035 },
  ];
  const points = buildRoutePoints(geometry);
  const total = points[points.length - 1].cumulativeDistanceMeters;
  const result = findNearestPointOnRoute(geometry[0], points);
  assert.ok(result);
  assert.ok(result!.distanceRemainingMeters <= total + 0.001);
});

function makeStep(type: number, wayPoints: [number, number], name = "-"): RouteStep {
  return { type, instructionEn: "", distanceMeters: 10, durationSeconds: 5, wayPoints, streetName: name === "-" ? null : name };
}

test("findUpcomingStep: 現在地点が含まれるstepと、その次のstepを正しく特定する", () => {
  const steps = [makeStep(11, [0, 5]), makeStep(0, [5, 8], "みおつくしプロムナード"), makeStep(1, [8, 14])];
  const result = findUpcomingStep(steps, 6); // 2番目のstep(5〜8)の途中
  assert.equal(result.currentStep, steps[1]);
  assert.equal(result.nextStep, steps[2]);
});

test("findUpcomingStep: 最後のstepの場合はnextStepがnull", () => {
  const steps = [makeStep(11, [0, 5]), makeStep(10, [5, 5])];
  const result = findUpcomingStep(steps, 5);
  assert.equal(result.nextStep, null);
});

test("describeStep: 道路名がある場合は併記し、ない場合は方向のみ", () => {
  assert.equal(describeStep(makeStep(0, [0, 1], "みおつくしプロムナード")), "左折（みおつくしプロムナード）");
  assert.equal(describeStep(makeStep(1, [0, 1])), "右折");
  assert.equal(describeStep(makeStep(10, [0, 0])), "目的地に到着");
});

test("updateOffRouteState: 閾値内なら逸脱にならない", () => {
  const state = updateOffRouteState(initialOffRouteState(), 5, 10);
  assert.equal(state.isOffRoute, false);
});

test("updateOffRouteState: 閾値超えがOFF_ROUTE_CONSECUTIVE_READINGS回続くまではfalse", () => {
  let state = initialOffRouteState();
  for (let i = 0; i < OFF_ROUTE_CONSECUTIVE_READINGS - 1; i++) {
    state = updateOffRouteState(state, OFF_ROUTE_BASE_METERS + 100, 5);
    assert.equal(state.isOffRoute, false);
  }
  state = updateOffRouteState(state, OFF_ROUTE_BASE_METERS + 100, 5);
  assert.equal(state.isOffRoute, true);
});

test("updateOffRouteState: 1回でも閾値内に戻ると連続カウントがリセットされる", () => {
  let state = initialOffRouteState();
  state = updateOffRouteState(state, OFF_ROUTE_BASE_METERS + 100, 5);
  state = updateOffRouteState(state, OFF_ROUTE_BASE_METERS + 100, 5);
  state = updateOffRouteState(state, 1, 5); // 閾値内に戻る
  assert.equal(state.consecutiveOverThreshold, 0);
  assert.equal(state.isOffRoute, false);
});

test("updateOffRouteState: GPS精度が悪いほど閾値が緩くなる(誤判定を避ける)", () => {
  // accuracy=200mなら閾値は200*1.5=300m。距離100mは閾値内でoffRouteにならない。
  const state = updateOffRouteState(initialOffRouteState(), 100, 200);
  assert.equal(state.isOffRoute, false);
});

test("hasArrivedNearDestination: 到着地点そのものならtrue", () => {
  const dest = { lat: 34.6937, lng: 135.5023 };
  assert.equal(hasArrivedNearDestination(dest, dest, 10), true);
});

test("hasArrivedNearDestination: ARRIVAL_BASE_METERSより十分離れていればfalse", () => {
  const dest = { lat: 34.6937, lng: 135.5023 };
  const far = { lat: 34.7, lng: 135.53 }; // 明らかに数km離れている
  assert.equal(hasArrivedNearDestination(far, dest, 10), false);
});

test("hasArrivedNearDestination: GPS精度が悪い場合は閾値がaccuracy側まで広がる", () => {
  const dest = { lat: 34.6937, lng: 135.5023 };
  // ARRIVAL_BASE_METERSより少し遠いがaccuracy(100m)以内の地点
  const near = { lat: 34.6937 + (ARRIVAL_BASE_METERS + 10) / 111000, lng: 135.5023 };
  assert.equal(hasArrivedNearDestination(near, dest, 100), true);
});
