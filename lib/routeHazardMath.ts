// Phase 5A.2: ルートハザード評価の「数値計算」部分のみを切り出したモジュール。
//
// このファイルはネットワーク・外部モジュールに一切依存しない純粋な計算ロジックのみを
// 含む（テスト容易性のため）。タイル取得等のI/Oは lib/routeHazardEvaluation.ts 側で行う。
// 単体テストは lib/routeHazardMath.test.ts を参照。

export type LatLng = { lat: number; lng: number };

export function haversineDistanceMeters(a: LatLng, b: LatLng): number {
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

export type RouteSample = {
  point: LatLng;
  /** ルート始点からの道なり（折れ線に沿った）累積距離(m) */
  cumulativeDistanceMeters: number;
};

/**
 * 折れ線（ルートの頂点列）を、指定した間隔（m）でサンプリングした地点の配列にする。
 * 始点・終点は必ず含む。各サンプルに「道なりの累積距離」を付与する。
 *
 * 【Phase5A.2での修正】以前はサンプル間の距離を直線(Haversine)で再計算しており、
 * 道が曲がる区間で実際の経路距離より短く算出される不具合があった。
 * ここでは道なりの累積距離を直接記録するため、その問題は起きない。
 */
export function sampleRouteAtInterval(geometry: LatLng[], intervalMeters: number): RouteSample[] {
  if (geometry.length === 0) return [];
  if (geometry.length === 1) return [{ point: geometry[0], cumulativeDistanceMeters: 0 }];

  const samples: RouteSample[] = [{ point: geometry[0], cumulativeDistanceMeters: 0 }];
  let distanceSinceLastSample = 0;
  // segStartまでの道なり累積距離（現在処理中の原頂点セグメントの長さはまだ含まない）
  let pathDistanceBeforeSegment = 0;

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
      samples.push({
        point: interpolate(segStart, segEnd, Math.min(1, t)),
        cumulativeDistanceMeters: pathDistanceBeforeSegment + coveredInSeg,
      });
      distanceSinceLastSample = 0;
    }
    distanceSinceLastSample += segLength - coveredInSeg;
    pathDistanceBeforeSegment += segLength;
  }

  const totalPathDistance = pathDistanceBeforeSegment;
  const lastSample = samples[samples.length - 1];
  if (totalPathDistance - lastSample.cumulativeDistanceMeters > 0.01) {
    samples.push({ point: geometry[geometry.length - 1], cumulativeDistanceMeters: totalPathDistance });
  } else {
    lastSample.cumulativeDistanceMeters = totalPathDistance;
  }

  return samples;
}

export type DepthRank = 0 | 1 | 2 | 3 | 4 | 5;

export type SamplePointResult =
  | { status: "evaluated"; rank: DepthRank }
  | { status: "unknown"; reason: "no_tile" | "fetch_error" | "unrecognized_color" };

export type AggregatedHazardResult = {
  hazardEvaluationDistanceMeters: number;
  evaluatedDistanceMeters: number;
  unavailableDistanceMeters: number;
  evaluationCoverageRatio: number | null;
  floodCrossingDistanceMeters: number;
  floodCrossingRatioAmongEvaluatedDistance: number | null;
  unavailableSampleCount: number;
  maxDepthRank: DepthRank;
};

/**
 * サンプル地点列とその判定結果から、ルート全体の集計値を計算する（純粋関数）。
 */
export function aggregateRouteHazardResults(
  samples: RouteSample[],
  results: SamplePointResult[]
): AggregatedHazardResult {
  let evaluatedDistance = 0;
  let hazardDistance = 0;
  let unavailableDistance = 0;
  let unavailableCount = 0;
  let maxRank: DepthRank = 0;

  for (let i = 0; i < samples.length - 1; i++) {
    const segLength = samples[i + 1].cumulativeDistanceMeters - samples[i].cumulativeDistanceMeters;
    const a = results[i];
    const b = results[i + 1];

    if (a.status === "unknown" || b.status === "unknown") {
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
    if (r.status === "unknown") unavailableCount++;
  }

  const hazardEvaluationDistance = samples.length > 0 ? samples[samples.length - 1].cumulativeDistanceMeters : 0;

  return {
    hazardEvaluationDistanceMeters: hazardEvaluationDistance,
    evaluatedDistanceMeters: evaluatedDistance,
    unavailableDistanceMeters: unavailableDistance,
    evaluationCoverageRatio: hazardEvaluationDistance > 0 ? evaluatedDistance / hazardEvaluationDistance : null,
    floodCrossingDistanceMeters: hazardDistance,
    floodCrossingRatioAmongEvaluatedDistance: evaluatedDistance > 0 ? hazardDistance / evaluatedDistance : null,
    unavailableSampleCount: unavailableCount,
    maxDepthRank: maxRank,
  };
}
