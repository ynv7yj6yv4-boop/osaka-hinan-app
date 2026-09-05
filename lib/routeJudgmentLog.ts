// Phase 5A / 5A.1 / 5A.2: 避難ルート判定ログ（卒業研究としての再現性のための記録構造）
// Phase4Aの JudgmentLog と対になるもの。永続保存はまだ行わない。

import type { LatLng } from "./routeHazardEvaluation";
import type { RouteHazardEvaluation } from "./routeHazardEvaluation";
import type { FloodShelterCandidate } from "./floodShelterCandidates";

// 判定ルールを変更した場合はこの値を更新する。
// Phase5A.3: Phase3と共通のハザード判定ロジック(lib/hazardPixelClassifier.ts)を使用するよう統一。
// unknownの理由別内訳を追加。
export const ROUTE_RULE_VERSION = "phase5a3-flood-only-v4";

export type RouteJudgmentLog = {
  judgedAt: string;
  origin: LatLng;
  destination: { id: string; name: string; lat: number; lng: number };
  hazardContext: "flood";
  route: {
    provider: string;
    /** openrouteserviceが報告するルート距離（道路網に基づく正式な距離） */
    routingDistanceMeters: number;
    durationSeconds: number;
    geometryPointCount: number;
  };
  sampling: {
    intervalMeters: number;
    sampleCount: number;
    /** 参考値。ネットワーク条件（キャッシュ有無等）に左右されるため、
     *  厳密なアルゴリズム比較には使えない（data/README.md参照）。 */
    processingTimeMs: number;
  };
  floodHazard: {
    /** このハザード評価が対象とした道なりの総距離。routingDistanceMetersとは
     *  独立に計算しており、通常0.1%未満のごくわずかな差異がありうる。 */
    hazardEvaluationDistanceMeters: number;
    evaluatedDistanceMeters: number;
    unavailableDistanceMeters: number;
    /** evaluatedDistanceMeters / hazardEvaluationDistanceMeters */
    evaluationCoverageRatio: number | null;
    crossingDistanceMeters: number;
    /** crossingDistanceMeters / evaluatedDistanceMeters（分母は評価済み区間のみ） */
    crossingRatioAmongEvaluatedDistance: number | null;
    maxDepthRank: number;
    unavailableSampleCount: number;
    /** unknownの理由別内訳（研究ログでの追跡用） */
    unavailableReasonCounts: { no_tile: number; fetch_error: number; color_unknown: number };
  };
  ruleVersion: string;
  dataSourcesUsed: string[];
};

export function buildRouteJudgmentLog(params: {
  origin: LatLng;
  destination: FloodShelterCandidate;
  provider: string;
  routingDistanceMeters: number;
  durationSeconds: number;
  geometryPointCount: number;
  evaluation: RouteHazardEvaluation;
}): RouteJudgmentLog {
  const { origin, destination, provider, routingDistanceMeters, durationSeconds, geometryPointCount, evaluation } =
    params;

  return {
    judgedAt: new Date().toISOString(),
    origin,
    destination: {
      id: destination.id,
      name: destination.name,
      lat: destination.lat,
      lng: destination.lng,
    },
    hazardContext: "flood",
    route: { provider, routingDistanceMeters, durationSeconds, geometryPointCount },
    sampling: {
      intervalMeters: evaluation.sampleIntervalMeters,
      sampleCount: evaluation.sampleCount,
      processingTimeMs: evaluation.processingTimeMs,
    },
    floodHazard: {
      hazardEvaluationDistanceMeters: evaluation.hazardEvaluationDistanceMeters,
      evaluatedDistanceMeters: evaluation.evaluatedDistanceMeters,
      unavailableDistanceMeters: evaluation.unavailableDistanceMeters,
      evaluationCoverageRatio: evaluation.evaluationCoverageRatio,
      crossingDistanceMeters: evaluation.floodCrossingDistanceMeters,
      crossingRatioAmongEvaluatedDistance: evaluation.floodCrossingRatioAmongEvaluatedDistance,
      maxDepthRank: evaluation.maxDepthRank,
      unavailableSampleCount: evaluation.unavailableSampleCount,
      unavailableReasonCounts: evaluation.unavailableReasonCounts,
    },
    ruleVersion: ROUTE_RULE_VERSION,
    dataSourcesUsed: [
      "国土地理院 指定緊急避難場所データ（大阪市）",
      "国土交通省 ハザードマップポータルサイト（洪水浸水想定区域）",
      "openrouteservice（徒歩ルート）",
    ],
  };
}
