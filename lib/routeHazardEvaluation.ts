// Phase 5A / 5A.1 / 5A.2: 徒歩ルート上の洪水ハザード評価
//
// Phase3の低レベル処理（タイル取得・ピクセル読み取り・色の凡例）はそのまま再利用するが、
// 「ルートを評価する」というPhase5A固有のロジックはこのファイルに分離している。
// lib/riskAssessment.ts（現在地単体の判定）には手を加えない。
//
// 数値計算部分（サンプリング・集計）は lib/routeHazardMath.ts に分離し、
// ネットワークに依存しない単体テスト（lib/routeHazardMath.test.ts）を追加した。
// このファイルはタイル取得（I/O）とそれらの計算の呼び出しのみを担当する。
//
// 【Phase5A.2での修正（重要）】
// Phase5A.1では、サンプル点どうしの距離を直線（Haversine）で再計算していたため、
// 道が曲がる区間で実際の経路距離より短く算出される不具合があった
// （間隔が粗いほど誤差が拡大し、ORSの報告距離との乖離も大きくなっていた）。
// 詳細な原因調査・実データでの検証記録は data/README.md を参照。
//
// 【距離フィールドの基準】
// - hazardEvaluationDistanceMeters: このハザード評価が対象とした、道なりの総距離。
//   openrouteserviceが報告する距離（呼び出し側で別途 routingDistanceMeters として保持）
//   とは独立に、ルートのgeometry（頂点列）から道なりに計算しているため、
//   丸め・頂点間隔の違いにより、ごくわずかな差異が生じる場合がある。
// - evaluatedDistanceMeters + unavailableDistanceMeters = hazardEvaluationDistanceMeters
// - evaluationCoverageRatio = evaluatedDistanceMeters / hazardEvaluationDistanceMeters
// - floodCrossingRatioAmongEvaluatedDistance = floodCrossingDistanceMeters / evaluatedDistanceMeters
//   （分母は「評価できた区間」のみ。ルート総距離ではない）
//
// 【404の意味について（data/README.mdに詳細記録）】
// タイルが存在する(200)場合、透明ピクセル(alpha=0)は「確認できた区域外」として
// evaluated 扱いにする。一方404（タイル自体が存在しない）は、区域外の確定判定
// ではなく「このタイルデータだけでは判定できない」状態として "unknown" に分類する。
// 404が具体的に「区域外」「データ未整備」のどちらを意味するかは、公式資料からは
// 断定できなかった（判断不能）。

import { HAZARD_TILE_URL } from "@/components/hazardLayers";
import { matchDepthColor } from "./hazardColorLegend";
import { samplePixelFromTile } from "./tilePixel";
import {
  sampleRouteAtInterval as sampleRouteAtIntervalMath,
  aggregateRouteHazardResults,
  type LatLng,
  type SamplePointResult,
  type DepthRank,
  type RouteSample,
} from "./routeHazardMath";

export type { LatLng, RouteSample, SamplePointResult, DepthRank };
export { sampleRouteAtIntervalMath as sampleRouteAtInterval };

// デフォルトのサンプリング間隔（m）。卒論の検証で20m/50m/100m等に変更して比較する想定のため、
// 呼び出し側から上書き可能にしている（このファイル内の値は「デフォルト」に過ぎない）。
export const DEFAULT_SAMPLE_INTERVAL_METERS = 30;

async function assessFloodAtPoint(point: LatLng): Promise<SamplePointResult> {
  const result = await samplePixelFromTile(HAZARD_TILE_URL.flood, point.lat, point.lng);
  if (result.kind === "error") return { status: "unknown", reason: "fetch_error" };
  if (result.kind === "no_tile") return { status: "unknown", reason: "no_tile" };
  if (result.a === 0) return { status: "evaluated", rank: 0 };
  const match = matchDepthColor(result.r, result.g, result.b);
  if (!match.matched) return { status: "unknown", reason: "unrecognized_color" };
  return { status: "evaluated", rank: match.rank };
}

export type RouteHazardEvaluation = {
  sampleIntervalMeters: number;
  sampleCount: number;
  hazardEvaluationDistanceMeters: number;
  evaluatedDistanceMeters: number;
  unavailableDistanceMeters: number;
  evaluationCoverageRatio: number | null;
  floodCrossingDistanceMeters: number;
  floodCrossingRatioAmongEvaluatedDistance: number | null;
  unavailableSampleCount: number;
  /** 【限界】サンプル地点間に、サンプリングされなかった浸水域が存在する可能性があり、
   *  実際の最大値を見逃す場合がある（詳細はdata/README.md参照）。 */
  maxDepthRank: DepthRank;
  /** 参考値。ネットワーク条件（キャッシュ有無等）に左右されるため、
   *  厳密なアルゴリズム比較には使えない（data/README.md参照）。 */
  processingTimeMs: number;
};

/**
 * ルートの折れ線をサンプリングし、洪水ハザードを評価する。
 *
 * 【区間の近似方法】
 * サンプル間の区間は「区間の両端のいずれかで洪水ハザードが検出されたら、
 * その区間全体を“ハザードあり”とみなす」という単純な規則で集計している。
 * Phase5A.1の実験では、この近似によりサンプリング間隔が粗いほど
 * 洪水区域通過距離が増加する傾向が確認された。ただし「20mが真値に最も近い」
 * という結論はまだ出せていない（data/README.md参照）。
 *
 * 【重要】未評価区間は「洪水ハザードなし（安全）」として扱わない。
 */
export async function evaluateRouteFloodHazard(
  geometry: LatLng[],
  intervalMeters: number = DEFAULT_SAMPLE_INTERVAL_METERS
): Promise<RouteHazardEvaluation> {
  const startedAt = Date.now();
  const samples = sampleRouteAtIntervalMath(geometry, intervalMeters);
  const results = await Promise.all(samples.map((s) => assessFloodAtPoint(s.point)));
  const aggregated = aggregateRouteHazardResults(samples, results);

  return {
    sampleIntervalMeters: intervalMeters,
    sampleCount: samples.length,
    processingTimeMs: Date.now() - startedAt,
    ...aggregated,
  };
}
