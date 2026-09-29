// lib/routeSegmentRisk.ts の単体テスト。
//
// determineSegmentRisk()・combineDepthRank()・mergeSubSegments()・
// sliceRouteGeometry()は外部I/Oを持たない純粋関数のため直接検証する。
// evaluateRouteSegmentRisk()自体(タイル取得・ハザード判定を含む一連の流れ)は、
// globalThis.fetch を一時的に差し替えることで、実際のネットワークなしに
// エンドツーエンドの配線を1回だけ検証する。
//
// 【2026-09-30の方針・訂正版】内水氾濫は「データが確認できない地域」でのみ
// 評価を省略する。determineSegmentRisk()のinlandFlood引数は、地域非対応
// （スコープ外）の場合はnull、データが確認できる地域では通常の
// DepthRankAssessmentを渡す（lib/routeSegmentRisk.ts参照）。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  determineSegmentRisk,
  combineDepthRank,
  mergeSubSegments,
  sliceRouteGeometry,
  evaluateRouteSegmentRisk,
  ROUTE_SEGMENT_RISK_CONFIG,
  type SubSegmentAssessment,
  type DepthRankAssessment,
} from "./routeSegmentRisk.ts";
import type { LatLng } from "./routeHazardMath.ts";

const EVALUATED = (rank: 0 | 1 | 2 | 3 | 4 | 5): DepthRankAssessment => ({ status: "evaluated", rank });
const UNKNOWN: DepthRankAssessment = { status: "unknown" };

// --- combineDepthRank ---

test("combineDepthRank: どちらかがunknownならunknown", () => {
  assert.deepEqual(combineDepthRank(EVALUATED(2), UNKNOWN), { status: "unknown" });
  assert.deepEqual(combineDepthRank(UNKNOWN, EVALUATED(2)), { status: "unknown" });
});

test("combineDepthRank: 両方評価済みなら大きい方のrankを採用", () => {
  assert.deepEqual(combineDepthRank(EVALUATED(1), EVALUATED(3)), { status: "evaluated", rank: 3 });
});

// --- determineSegmentRisk（内水氾濫データが確認できない地域ではinlandFlood=null） ---

test("洪水が高リスク(higherAttentionDepthRank以上)ならhigher_attention(内水氾濫スコープ外)", () => {
  const flood = EVALUATED(ROUTE_SEGMENT_RISK_CONFIG.higherAttentionDepthRank);
  const result = determineSegmentRisk(flood, null, false);
  assert.equal(result.riskLevel, "higher_attention");
  assert.ok(result.reasons.includes("flood_hazard_area"));
});

test("内水氾濫が高リスクならhigher_attention(内水氾濫データが確認できる地域)", () => {
  const inland = EVALUATED(ROUTE_SEGMENT_RISK_CONFIG.higherAttentionDepthRank);
  const result = determineSegmentRisk(UNKNOWN, inland, false);
  assert.equal(result.riskLevel, "higher_attention");
  assert.ok(result.reasons.includes("inland_flood_hazard_area"));
});

test("terrainのみ低い(洪水はunknown、内水氾濫はスコープ外)場合はattentionにとどまり、higher_attentionにはしない", () => {
  const result = determineSegmentRisk(UNKNOWN, null, true);
  assert.equal(result.riskLevel, "attention");
  assert.deepEqual(result.reasons, ["relatively_low_terrain"]);
});

test("洪水・内水・地形が複合的にリスクを示す場合、reasonsに複数の理由が含まれる", () => {
  const flood = EVALUATED(ROUTE_SEGMENT_RISK_CONFIG.attentionDepthRank);
  const inland = EVALUATED(ROUTE_SEGMENT_RISK_CONFIG.attentionDepthRank);
  const result = determineSegmentRisk(flood, inland, true);
  assert.equal(result.riskLevel, "attention");
  assert.ok(result.reasons.includes("flood_hazard_area"));
  assert.ok(result.reasons.includes("inland_flood_hazard_area"));
  assert.ok(result.reasons.includes("relatively_low_terrain"));
});

test("洪水が評価済みでハザードなし・地形も低くない・内水氾濫がスコープ外ならrelatively_low", () => {
  const result = determineSegmentRisk(EVALUATED(0), null, false);
  assert.equal(result.riskLevel, "relatively_low");
  assert.deepEqual(result.reasons, ["no_significant_hazard"]);
});

test("洪水・内水とも評価済みでハザードなし・地形も低くなければrelatively_low", () => {
  const result = determineSegmentRisk(EVALUATED(0), EVALUATED(0), false);
  assert.equal(result.riskLevel, "relatively_low");
  assert.deepEqual(result.reasons, ["no_significant_hazard"]);
});

test("【重要】洪水のみ評価できてもハザードなし・内水がunknown(スコープ内)の場合はrelatively_lowにしない(unknown混在)", () => {
  const result = determineSegmentRisk(EVALUATED(0), UNKNOWN, false);
  assert.notEqual(result.riskLevel, "relatively_low");
  assert.equal(result.riskLevel, "unknown");
});

test("【重要】洪水が評価不能な場合はunknown(内水氾濫がスコープ外でもrelatively_lowにしない)", () => {
  const result = determineSegmentRisk(UNKNOWN, null, false);
  assert.equal(result.riskLevel, "unknown");
  assert.deepEqual(result.reasons, ["data_unavailable"]);
});

test("【重要】洪水・内水・地形すべて評価不能な場合はunknown(relatively_lowにしない)", () => {
  const result = determineSegmentRisk(UNKNOWN, UNKNOWN, false);
  assert.equal(result.riskLevel, "unknown");
  assert.deepEqual(result.reasons, ["data_unavailable"]);
});

// --- mergeSubSegments ---

const P = (lat: number, lng: number): LatLng => ({ lat, lng });

function makeSub(overrides: Partial<SubSegmentAssessment>): SubSegmentAssessment {
  return {
    startDistanceMeters: 0,
    endDistanceMeters: 30,
    riskLevel: "relatively_low",
    reasons: ["no_significant_hazard"],
    flood: EVALUATED(0),
    inlandFlood: null,
    elevationMeters: 1.0,
    elevationSource: "dem5a",
    relativeElevationMeters: 0,
    ...overrides,
  };
}

test("mergeSubSegments: 同じriskLevelが連続する区間は1つに結合される", () => {
  const geometry = [P(0, 0), P(0.001, 0), P(0.002, 0), P(0.003, 0)];
  const subs: SubSegmentAssessment[] = [
    makeSub({ startDistanceMeters: 0, endDistanceMeters: 30, riskLevel: "relatively_low" }),
    makeSub({ startDistanceMeters: 30, endDistanceMeters: 60, riskLevel: "relatively_low" }),
    makeSub({ startDistanceMeters: 60, endDistanceMeters: 90, riskLevel: "relatively_low" }),
  ];
  const merged = mergeSubSegments(subs, geometry);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].startDistanceMeters, 0);
  assert.equal(merged[0].endDistanceMeters, 90);
});

test("mergeSubSegments: riskLevelが変化する箇所で区間が分割される", () => {
  const geometry = [P(0, 0), P(0.001, 0), P(0.002, 0), P(0.003, 0)];
  const subs: SubSegmentAssessment[] = [
    makeSub({ startDistanceMeters: 0, endDistanceMeters: 30, riskLevel: "relatively_low" }),
    makeSub({ startDistanceMeters: 30, endDistanceMeters: 60, riskLevel: "attention", reasons: ["relatively_low_terrain"] }),
    makeSub({ startDistanceMeters: 60, endDistanceMeters: 90, riskLevel: "attention", reasons: ["relatively_low_terrain"] }),
  ];
  const merged = mergeSubSegments(subs, geometry);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].riskLevel, "relatively_low");
  assert.equal(merged[1].riskLevel, "attention");
  assert.equal(merged[1].startDistanceMeters, 30);
  assert.equal(merged[1].endDistanceMeters, 90);
});

test("mergeSubSegments: 結合後の座標は元のgeometryの範囲を維持する(区間の始点・終点がgeometryの緯度経度範囲内)", () => {
  const geometry = [P(0, 0), P(0.0009, 0)]; // 約100m
  const subs: SubSegmentAssessment[] = [makeSub({ startDistanceMeters: 0, endDistanceMeters: 100 })];
  const merged = mergeSubSegments(subs, geometry);
  assert.equal(merged.length, 1);
  assert.ok(merged[0].coordinates.length >= 2);
  assert.equal(merged[0].coordinates[0].lat, 0);
  assert.ok(merged[0].coordinates[merged[0].coordinates.length - 1].lat <= geometry[1].lat + 1e-9);
});

test("mergeSubSegments: inlandFloodがスコープ外(null)同士は結合後もnullのまま(架空のunknownを作らない)", () => {
  const geometry = [P(0, 0), P(0.001, 0), P(0.002, 0)];
  const subs: SubSegmentAssessment[] = [
    makeSub({ startDistanceMeters: 0, endDistanceMeters: 30, inlandFlood: null }),
    makeSub({ startDistanceMeters: 30, endDistanceMeters: 60, inlandFlood: null }),
  ];
  const merged = mergeSubSegments(subs, geometry);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].inlandFlood, null);
});

test("mergeSubSegments: inlandFloodがスコープ内同士は通常どおりcombineDepthRankされる", () => {
  const geometry = [P(0, 0), P(0.001, 0), P(0.002, 0)];
  const subs: SubSegmentAssessment[] = [
    makeSub({ startDistanceMeters: 0, endDistanceMeters: 30, inlandFlood: EVALUATED(1) }),
    makeSub({ startDistanceMeters: 30, endDistanceMeters: 60, inlandFlood: EVALUATED(3) }),
  ];
  const merged = mergeSubSegments(subs, geometry);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].inlandFlood, { status: "evaluated", rank: 3 });
});

// --- sliceRouteGeometry ---

test("sliceRouteGeometry: 区間の範囲に応じて元のgeometryの頂点を保持する(曲がり角を直線化しない)", () => {
  // 直角に曲がるルート(0,0) -> (0,0.001) -> (0.001,0.001)
  const geometry = [P(0, 0), P(0.001, 0), P(0.001, 0.001)];
  const sliced = sliceRouteGeometry(geometry, 0, 1000000); // 全区間
  // 曲がり角の頂点(0.001, 0)が結果に含まれているはず(直線で結ばれていない)
  assert.ok(sliced.some((p) => Math.abs(p.lat - 0.001) < 1e-9 && Math.abs(p.lng - 0) < 1e-9));
});

test("sliceRouteGeometry: 空のgeometryは空配列を返す", () => {
  assert.deepEqual(sliceRouteGeometry([], 0, 100), []);
});

// --- evaluateRouteSegmentRisk (エンドツーエンド、globalThis.fetchを一時差し替え) ---

test("evaluateRouteSegmentRisk: inundationTileUrl省略時は内水氾濫タイルへのリクエストを行わず、区間が生成される", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  try {
    // 洪水タイル(画像)・DEMタイル(テキスト)のいずれに対しても、
    // 「取得できない(404相当)」を返す最も単純なモック。
    // -> flood/terrainすべてunknownになり、riskLevelはunknownになるはず。
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const geometry = [
      { lat: 34.6937, lng: 135.5023 },
      { lat: 34.694, lng: 135.5026 },
      { lat: 34.6945, lng: 135.503 },
    ];
    const result = await evaluateRouteSegmentRisk(geometry, { intervalMeters: 30 });

    assert.ok(result.segments.length > 0);
    assert.ok(result.sampleCount > 0);
    assert.equal(result.sampleIntervalMeters, 30);
    for (const seg of result.segments) {
      assert.equal(seg.riskLevel, "unknown");
      assert.equal(seg.inlandFlood, null, "inundationTileUrl省略時はinlandFloodが常にnull(スコープ外)");
      assert.ok(seg.coordinates.length >= 2);
    }
    assert.ok(
      requestedUrls.every((u) => !u.includes("02_naisui")),
      "inundationTileUrl省略時は内水氾濫タイル(02_naisui)へのリクエストが一切発生しない"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("evaluateRouteSegmentRisk: inundationTileUrlを渡すと内水氾濫も評価対象になる(スコープ内)", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  try {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const geometry = [
      { lat: 34.6937, lng: 135.5023 },
      { lat: 34.694, lng: 135.5026 },
    ];
    const result = await evaluateRouteSegmentRisk(geometry, {
      intervalMeters: 30,
      inundationTileUrl: "https://disaportaldata.gsi.go.jp/raster/02_naisui_pref_data/27/{z}/{x}/{y}.png",
    });

    for (const seg of result.segments) {
      // 404モックのためunknownになるが、「スコープ外(null)」ではなく
      // 「評価を試みたがunknown」であることを確認する。
      assert.notEqual(seg.inlandFlood, null);
    }
    assert.ok(
      requestedUrls.some((u) => u.includes("02_naisui")),
      "inundationTileUrlを渡した場合は内水氾濫タイルへのリクエストが発生する"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
