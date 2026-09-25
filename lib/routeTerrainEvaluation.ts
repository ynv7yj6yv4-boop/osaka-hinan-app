// 避難ルートの各地点について、DEM標高データから「絶対標高」だけでなく
// 「周囲と比べて相対的に低いかどうか」を評価するモジュール。
//
// 【重要・誤解防止】ここで分かるのは「周囲より地形が低いこと」だけである。
// 排水能力・河川・下水・堤防等は一切考慮していないため、
// 「水が溜まりやすい」「冠水しやすい」と断定しない
// (呼び出し側のUI文言でも「周辺より低い地形」という表現に統一すること)。
// 流向・flow accumulation・depression filling等の本格的な水理解析は行わない
// (研究用プロトタイプの簡易な相対標高指標にとどめる)。
//
// 標高取得そのもの(タイルfetch・cache・fallback)はlib/gsiElevationTile.tsに
// 委譲し、このファイルは「地点1つを受け取って地形評価を返す」ロジックのみを持つ。
// テスト容易性のため、標高取得は関数として注入できるようにしている
// (実際のタイル取得を伴わずに、周囲より低い/同程度/高い等のケースを検証できる)。

import type { LatLng } from "./routeHazardMath.ts";
import type { ElevationLookupResult, ElevationSource } from "./gsiElevationTile.ts";

// 【重要】以下は研究用プロトタイプの暫定パラメータであり、
// 科学的に確定した閾値ではない。将来の検証結果次第で見直す前提の値。
export const TERRAIN_EVALUATION_CONFIG = {
  /** 相対標高を評価する際に比較する周囲の範囲(半径, m)。 */
  neighborhoodRadiusMeters: 50,
  /** 周囲の平均よりこの値(m)以上低ければ「相対的に低い地形」とみなす。 */
  lowRelativeElevationThresholdMeters: 0.5,
  /** 相対標高を算出するために必要な、有効な近傍標高データの最小数(全4点中)。 */
  minNeighborSamplesRequired: 2,
} as const;

export type TerrainAssessment = {
  elevationMeters: number | null;
  elevationSource: ElevationSource;
  /** 中心地点の標高 - 周囲の平均標高。負の値 = 周囲より低い。算出不能ならnull。 */
  relativeElevationMeters: number | null;
  /** relativeElevationMetersがlowRelativeElevationThresholdMeters以上低い場合のみtrue。算出不能な場合は必ずfalse(不明を「低い」と誤認させない)。 */
  isRelativelyLow: boolean;
};

export type ElevationLookupFn = (point: LatLng) => Promise<ElevationLookupResult>;

// 北・東・南・西の4方向。簡易な相対標高指標のため、これ以上の高密度サンプリングは行わない。
const NEIGHBOR_BEARINGS_DEG = [0, 90, 180, 270] as const;

/**
 * 小さい距離(数十〜百数十m程度)を前提とした簡易オフセット計算。
 * 緯度1度あたりの距離を球体近似で扱う(この距離域では十分な精度)。
 */
export function offsetLatLng(point: LatLng, bearingDeg: number, distanceMeters: number): LatLng {
  const R = 6371000;
  const bearingRad = (bearingDeg * Math.PI) / 180;
  const latRad = (point.lat * Math.PI) / 180;
  const dLat = (distanceMeters * Math.cos(bearingRad)) / R;
  const dLng = (distanceMeters * Math.sin(bearingRad)) / (R * Math.cos(latRad));
  return {
    lat: point.lat + (dLat * 180) / Math.PI,
    lng: point.lng + (dLng * 180) / Math.PI,
  };
}

/**
 * 1地点の地形評価(絶対標高＋相対標高)を行う。
 * 【重要】中心地点の標高自体が取得できない場合は、周囲の取得も行わず
 * ただちにunknown相当を返す(不要なリクエストを増やさない)。
 * 周囲4点のうち有効な標高がminNeighborSamplesRequired未満しか
 * 得られなかった場合も、relativeElevationMeters/isRelativelyLowは
 * 「不明」として扱う(取得できた絶対標高だけは返す)。
 */
export async function evaluateTerrainAtPoint(
  point: LatLng,
  lookupElevation: ElevationLookupFn
): Promise<TerrainAssessment> {
  const center = await lookupElevation(point);
  if (center.elevationMeters === null) {
    return { elevationMeters: null, elevationSource: "unknown", relativeElevationMeters: null, isRelativelyLow: false };
  }

  const neighborPoints = NEIGHBOR_BEARINGS_DEG.map((bearing) =>
    offsetLatLng(point, bearing, TERRAIN_EVALUATION_CONFIG.neighborhoodRadiusMeters)
  );
  const neighborResults = await Promise.all(neighborPoints.map((p) => lookupElevation(p)));
  const validNeighborElevations = neighborResults
    .map((r) => r.elevationMeters)
    .filter((v): v is number => v !== null);

  if (validNeighborElevations.length < TERRAIN_EVALUATION_CONFIG.minNeighborSamplesRequired) {
    return {
      elevationMeters: center.elevationMeters,
      elevationSource: center.source,
      relativeElevationMeters: null,
      isRelativelyLow: false,
    };
  }

  const neighborAverage =
    validNeighborElevations.reduce((sum, v) => sum + v, 0) / validNeighborElevations.length;
  const relativeElevationMeters = center.elevationMeters - neighborAverage;
  const isRelativelyLow =
    relativeElevationMeters <= -TERRAIN_EVALUATION_CONFIG.lowRelativeElevationThresholdMeters;

  return {
    elevationMeters: center.elevationMeters,
    elevationSource: center.source,
    relativeElevationMeters,
    isRelativelyLow,
  };
}
