// lib/routeTerrainEvaluation.ts の単体テスト。
// 標高取得(lookupElevation)を注入することで、実際のDEMタイル取得を伴わずに
// 「周囲より低い/同程度/高い」「周辺データ不足」「中心地点自体が欠損」の
// 各ケースを検証する。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateTerrainAtPoint,
  offsetLatLng,
  TERRAIN_EVALUATION_CONFIG,
  type ElevationLookupFn,
} from "./routeTerrainEvaluation.ts";
import type { ElevationLookupResult } from "./gsiElevationTile.ts";
import type { LatLng } from "./routeHazardMath.ts";

const CENTER: LatLng = { lat: 34.6937, lng: 135.5023 };

/** center/北/東/南/西それぞれに固定の標高を返すモック。 */
function makeLookup(
  centerElevation: number | null,
  neighborElevations: { n: number | null; e: number | null; s: number | null; w: number | null }
): { lookup: ElevationLookupFn; callCount: () => number } {
  let calls = 0;
  const lookup: ElevationLookupFn = async (point) => {
    calls++;
    const dLat = point.lat - CENTER.lat;
    const dLng = point.lng - CENTER.lng;
    if (Math.abs(dLat) < 1e-12 && Math.abs(dLng) < 1e-12) {
      return toResult(centerElevation);
    }
    if (Math.abs(dLat) > Math.abs(dLng)) {
      return toResult(dLat > 0 ? neighborElevations.n : neighborElevations.s);
    }
    return toResult(dLng > 0 ? neighborElevations.e : neighborElevations.w);
  };
  return { lookup, callCount: () => calls };
}

function toResult(v: number | null): ElevationLookupResult {
  return v === null ? { elevationMeters: null, source: "unknown" } : { elevationMeters: v, source: "dem5a" };
}

test("offsetLatLng: 北(bearing=0)は緯度が増える方向になる", () => {
  const p = offsetLatLng(CENTER, 0, 100);
  assert.ok(p.lat > CENTER.lat);
  assert.ok(Math.abs(p.lng - CENTER.lng) < 1e-6);
});

test("周囲より低い地点はisRelativelyLow=trueになる", async () => {
  const { lookup } = makeLookup(1.0, { n: 2.0, e: 2.0, s: 2.0, w: 2.0 });
  const result = await evaluateTerrainAtPoint(CENTER, lookup);
  assert.equal(result.elevationMeters, 1.0);
  assert.equal(result.relativeElevationMeters, -1.0);
  assert.equal(result.isRelativelyLow, true);
});

test("周囲と同程度の地点はisRelativelyLow=falseになる", async () => {
  const { lookup } = makeLookup(1.0, { n: 1.1, e: 0.9, s: 1.0, w: 1.0 });
  const result = await evaluateTerrainAtPoint(CENTER, lookup);
  assert.equal(result.relativeElevationMeters, 0);
  assert.equal(result.isRelativelyLow, false);
});

test("周囲より高い地点はisRelativelyLow=falseになる(正の相対標高)", async () => {
  const { lookup } = makeLookup(3.0, { n: 1.0, e: 1.0, s: 1.0, w: 1.0 });
  const result = await evaluateTerrainAtPoint(CENTER, lookup);
  assert.equal(result.relativeElevationMeters, 2.0);
  assert.equal(result.isRelativelyLow, false);
});

test(`閾値ちょうど(${TERRAIN_EVALUATION_CONFIG.lowRelativeElevationThresholdMeters}m低い)はisRelativelyLow=trueになる`, async () => {
  const threshold = TERRAIN_EVALUATION_CONFIG.lowRelativeElevationThresholdMeters;
  const { lookup } = makeLookup(1.0, { n: 1.0 + threshold, e: 1.0 + threshold, s: 1.0 + threshold, w: 1.0 + threshold });
  const result = await evaluateTerrainAtPoint(CENTER, lookup);
  assert.equal(result.isRelativelyLow, true);
});

test("周辺データが不足(有効な近傍が1点のみ)している場合、相対標高は算出せずnullにする", async () => {
  const { lookup } = makeLookup(1.0, { n: 5.0, e: null, s: null, w: null });
  const result = await evaluateTerrainAtPoint(CENTER, lookup);
  assert.equal(result.elevationMeters, 1.0, "絶対標高自体は取得できていれば返す");
  assert.equal(result.relativeElevationMeters, null);
  assert.equal(result.isRelativelyLow, false, "不明を「低い」と誤認させない");
});

test("中心地点自体のDEMが欠損している場合、周囲への問い合わせを行わずunknownを返す", async () => {
  const { lookup, callCount } = makeLookup(null, { n: 1, e: 1, s: 1, w: 1 });
  const result = await evaluateTerrainAtPoint(CENTER, lookup);
  assert.deepEqual(result, {
    elevationMeters: null,
    elevationSource: "unknown",
    relativeElevationMeters: null,
    isRelativelyLow: false,
  });
  assert.equal(callCount(), 1, "中心地点の問い合わせ1回のみで、周囲4点は問い合わせないはず");
});
