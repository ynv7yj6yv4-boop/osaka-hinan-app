// Phase 5A: 徒歩ルート上の洪水ハザード評価
//
// Phase3の低レベル処理（タイル取得・ピクセル読み取り・色の凡例）はそのまま再利用するが、
// 「ルートを評価する」というPhase5A固有のロジックはこのファイルに分離している。
// lib/riskAssessment.ts（現在地単体の判定）には手を加えない。
//
// 【方針】
// - 対象は洪水のみ（Phase5B以降で内水氾濫・高潮に拡張する余地を残す）
// - サンプリング間隔は固定値に決め打ちせず、呼び出し側から指定できるようにする
// - サンプリングに失敗した区間は「危険ではない」とは扱わず、
//   「評価できなかった区間」として別枠で集計する

import { HAZARD_TILE_URL } from "@/components/hazardLayers";
import { matchDepthColor, type DepthRank } from "./hazardColorLegend";
import { samplePixelFromTile } from "./tilePixel";

export type LatLng = { lat: number; lng: number };

// デフォルトのサンプリング間隔（m）。卒論の検証で20m/50m/100m等に変更して比較する想定のため、
// 呼び出し側から上書き可能にしている（このファイル内の値は「デフォルト」に過ぎない）。
export const DEFAULT_SAMPLE_INTERVAL_METERS = 30;

function haversineDistanceMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function interpolate(a: LatLng, b: LatLng, t: number): LatLng {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

/**
 * 折れ線（ルートの頂点列）を、指定した間隔（m）でサンプリングした地点の配列にする。
 * 始点・終点は必ず含む。
 */
export function sampleRouteAtInterval(
  geometry: LatLng[],
  intervalMeters: number = DEFAULT_SAMPLE_INTERVAL_METERS
): LatLng[] {
  if (geometry.length === 0) return [];
  if (geometry.length === 1) return [geometry[0]];

  const points: LatLng[] = [geometry[0]];
  let distanceSinceLastSample = 0;

  for (let i = 0; i < geometry.length - 1; i++) {
    const segStart = geometry[i];
    const segEnd = geometry[i + 1];
    const segLength = haversineDistanceMeters(segStart, segEnd);
    if (segLength === 0) continue;

    let coveredInSeg = 0;
    while (distanceSinceLastSample + (segLength - coveredInSeg) >= intervalMeters) {
      const remaining = intervalMeters - distanceSinceLastSample;
      coveredInSeg += remaining;
      const t = coveredInSeg / segLength;
      points.push(interpolate(segStart, segEnd, Math.min(1, t)));
      distanceSinceLastSample = 0;
    }
    distanceSinceLastSample += segLength - coveredInSeg;
  }

  const last = geometry[geometry.length - 1];
  const lastSampled = points[points.length - 1];
  if (haversineDistanceMeters(lastSampled, last) > 1) {
    points.push(last);
  }
  return points;
}

export type SamplePointResult =
  | { status: "evaluated"; rank: DepthRank }
  | { status: "unavailable" };

async function assessFloodAtPoint(point: LatLng): Promise<SamplePointResult> {
  const result = await samplePixelFromTile(HAZARD_TILE_URL.flood, point.lat, point.lng);
  if (result.kind === "error" || result.kind === "no_tile") {
    return { status: "unavailable" };
  }
  if (result.a === 0) {
    return { status: "evaluated", rank: 0 };
  }
  const match = matchDepthColor(result.r, result.g, result.b);
  if (!match.matched) {
    return { status: "unavailable" };
  }
  return { status: "evaluated", rank: match.rank };
}

export type RouteHazardEvaluation = {
  sampleIntervalMeters: number;
  sampleCount: number;
  /** サンプル間の区間のうち、両端が評価できた区間の合計距離(m) */
  evaluatedDistanceMeters: number;
  /** 評価できた区間のうち、洪水ハザードが検出された区間の合計距離(m) */
  floodHazardDistanceMeters: number;
  /** floodHazardDistanceMeters / evaluatedDistanceMeters （evaluatedDistanceMetersが0の場合はnull） */
  floodHazardRatio: number | null;
  /** 評価できなかった（通信エラー等）区間の合計距離(m) */
  unavailableDistanceMeters: number;
  unavailableSampleCount: number;
  /** 検出された中で最大の想定浸水深ランク（0=検出なし） */
  maxDepthRank: DepthRank;
};

/**
 * ルートの折れ線をサンプリングし、洪水ハザードを評価する。
 * サンプル間の区間は「区間の両端のいずれかで洪水ハザードが検出されたら、
 * その区間全体を“ハザードあり”とみなす」という単純な規則で集計する
 * （区間の途中でハザードの有無が切り替わる可能性を考慮した、安全側＝過大評価寄りの近似）。
 */
export async function evaluateRouteFloodHazard(
  geometry: LatLng[],
  intervalMeters: number = DEFAULT_SAMPLE_INTERVAL_METERS
): Promise<RouteHazardEvaluation> {
  const samplePoints = sampleRouteAtInterval(geometry, intervalMeters);
  const results = await Promise.all(samplePoints.map(assessFloodAtPoint));

  let evaluatedDistance = 0;
  let hazardDistance = 0;
  let unavailableDistance = 0;
  let unavailableCount = 0;
  let maxRank: DepthRank = 0;

  for (let i = 0; i < samplePoints.length - 1; i++) {
    const segLength = haversineDistanceMeters(samplePoints[i], samplePoints[i + 1]);
    const a = results[i];
    const b = results[i + 1];

    if (a.status === "unavailable" || b.status === "unavailable") {
      unavailableDistance += segLength;
      continue;
    }

    evaluatedDistance += segLength;
    const segMaxRank = Math.max(a.rank, b.rank) as DepthRank;
    if (segMaxRank > 0) {
      hazardDistance += segLength;
    }
    maxRank = Math.max(maxRank, segMaxRank) as DepthRank;
  }

  for (const r of results) {
    if (r.status === "unavailable") unavailableCount++;
  }

  return {
    sampleIntervalMeters: intervalMeters,
    sampleCount: samplePoints.length,
    evaluatedDistanceMeters: evaluatedDistance,
    floodHazardDistanceMeters: hazardDistance,
    floodHazardRatio: evaluatedDistance > 0 ? hazardDistance / evaluatedDistance : null,
    unavailableDistanceMeters: unavailableDistance,
    unavailableSampleCount: unavailableCount,
    maxDepthRank: maxRank,
  };
}
