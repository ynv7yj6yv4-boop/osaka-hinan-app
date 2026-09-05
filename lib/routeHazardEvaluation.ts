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
  /** サンプリングした区間の合計距離(m)。 evaluatedDistanceMeters + unavailableDistanceMeters に等しい。
   *  openrouteserviceが報告するルート距離（WalkingRoute.distanceMeters）とは、
   *  サンプリングによる近似のため厳密には一致しない場合がある。 */
  routeTotalDistanceMeters: number;
  /** サンプル間の区間のうち、両端が評価できた区間の合計距離(m) */
  evaluatedDistanceMeters: number;
  /** 評価できなかった（通信エラー等）区間の合計距離(m)。「安全」を意味しない。 */
  unavailableDistanceMeters: number;
  /** evaluatedDistanceMeters / routeTotalDistanceMeters （routeTotalDistanceMetersが0の場合はnull）
   *  ＝ルートのうち、どれだけの割合を実際に評価できたか。100%未満の場合、
   *  この評価結果は「ルート全体」を保証するものではないことを意味する。 */
  evaluationCoverageRatio: number | null;
  /** 評価できた区間のうち、洪水ハザードが検出された区間の合計距離(m) */
  floodCrossingDistanceMeters: number;
  /** floodCrossingDistanceMeters / evaluatedDistanceMeters
   *  （evaluatedDistanceMetersが0の場合はnull）。
   *  【重要】分母は「評価できた区間」であり「ルート総距離」ではない。
   *  評価カバー率(evaluationCoverageRatio)が低い場合、この割合の信頼性も下がる。 */
  floodCrossingRatioAmongEvaluatedDistance: number | null;
  unavailableSampleCount: number;
  /** 検出された中で最大の想定浸水深ランク（0=検出なし）。
   *  【限界】サンプル地点間に、サンプリングされなかった浸水域が存在する可能性があり、
   *  実際の最大値を見逃す場合がある（詳細はdata/README.md参照）。 */
  maxDepthRank: DepthRank;
  /** この評価1回の処理時間(ms)。サンプリング間隔ごとの処理コスト比較に使用する。 */
  processingTimeMs: number;
};

/**
 * ルートの折れ線をサンプリングし、洪水ハザードを評価する。
 *
 * 【区間の近似方法（安全側に働く単純な規則）】
 * サンプル間の区間は「区間の両端のいずれかで洪水ハザードが検出されたら、
 * その区間全体を“ハザードあり”とみなす」という単純な規則で集計している。
 * これは区間の途中でハザードの有無が切り替わる可能性を考慮した近似であり、
 * 実際の浸水区域の境界がサンプル区間の中央付近にある場合、
 * 実際より広め（過大）に「ハザードあり」と評価される傾向がある
 * （逆に、区間の両端がたまたま浸水域の外側にある場合、区間中央の
 * 浸水域を見逃す可能性もゼロではない）。
 * サンプリング間隔を細かくするほどこの近似誤差は小さくなるはずだが、
 * その処理コストとのトレードオフはPhase5A.1の実験で検証する
 * （scripts/route-sampling-experiment.mjs の結果を参照）。
 *
 * 【重要】未評価区間は「洪水ハザードなし（安全）」として扱わない。
 * evaluatedDistanceMeters / unavailableDistanceMeters / evaluationCoverageRatio
 * を必ず分離して保持し、呼び出し側・UI側で「評価できていない」ことを
 * 明示できるようにしている。
 */
export async function evaluateRouteFloodHazard(
  geometry: LatLng[],
  intervalMeters: number = DEFAULT_SAMPLE_INTERVAL_METERS
): Promise<RouteHazardEvaluation> {
  const startedAt = Date.now();
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

  const routeTotalDistance = evaluatedDistance + unavailableDistance;

  return {
    sampleIntervalMeters: intervalMeters,
    sampleCount: samplePoints.length,
    routeTotalDistanceMeters: routeTotalDistance,
    evaluatedDistanceMeters: evaluatedDistance,
    unavailableDistanceMeters: unavailableDistance,
    evaluationCoverageRatio: routeTotalDistance > 0 ? evaluatedDistance / routeTotalDistance : null,
    floodCrossingDistanceMeters: hazardDistance,
    floodCrossingRatioAmongEvaluatedDistance: evaluatedDistance > 0 ? hazardDistance / evaluatedDistance : null,
    unavailableSampleCount: unavailableCount,
    maxDepthRank: maxRank,
    processingTimeMs: Date.now() - startedAt,
  };
}
