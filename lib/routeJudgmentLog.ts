// Phase 5A / 5A.1: 避難ルート判定ログ（卒業研究としての再現性のための記録構造）
// Phase4Aの JudgmentLog と対になるもの。永続保存はまだ行わない。

import type { LatLng } from "./routeHazardEvaluation";
import type { RouteHazardEvaluation } from "./routeHazardEvaluation";
import type { FloodShelterCandidate } from "./floodShelterCandidates";

// 判定ルールを変更した場合はこの値を更新する。
// Phase5A.1で評価カバー率・処理時間等のフィールドを追加したためバージョンを更新した。
export const ROUTE_RULE_VERSION = "phase5a1-flood-only-v2";

export type RouteJudgmentLog = {
  judgedAt: string;
  origin: LatLng;
  destination: { id: string; name: string; lat: number; lng: number };
  hazardContext: "flood";
  route: {
    provider: string;
    distanceMeters: number;
    durationSeconds: number;
    geometryPointCount: number;
  };
  sampling: {
    intervalMeters: number;
    sampleCount: number;
    processingTimeMs: number;
  };
  floodHazard: {
    routeTotalDistanceMeters: number;
    evaluatedDistanceMeters: number;
    unavailableDistanceMeters: number;
    evaluationCoverageRatio: number | null;
    crossingDistanceMeters: number;
    crossingRatioAmongEvaluatedDistance: number | null;
    maxDepthRank: number;
    unavailableSampleCount: number;
  };
  ruleVersion: string;
  dataSourcesUsed: string[];
};

export function buildRouteJudgmentLog(params: {
  origin: LatLng;
  destination: FloodShelterCandidate;
  provider: string;
  distanceMeters: number;
  durationSeconds: number;
  geometryPointCount: number;
  evaluation: RouteHazardEvaluation;
}): RouteJudgmentLog {
  const { origin, destination, provider, distanceMeters, durationSeconds, geometryPointCount, evaluation } =
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
    route: { provider, distanceMeters, durationSeconds, geometryPointCount },
    sampling: {
      intervalMeters: evaluation.sampleIntervalMeters,
      sampleCount: evaluation.sampleCount,
      processingTimeMs: evaluation.processingTimeMs,
    },
    floodHazard: {
      routeTotalDistanceMeters: evaluation.routeTotalDistanceMeters,
      evaluatedDistanceMeters: evaluation.evaluatedDistanceMeters,
      unavailableDistanceMeters: evaluation.unavailableDistanceMeters,
      evaluationCoverageRatio: evaluation.evaluationCoverageRatio,
      crossingDistanceMeters: evaluation.floodCrossingDistanceMeters,
      crossingRatioAmongEvaluatedDistance: evaluation.floodCrossingRatioAmongEvaluatedDistance,
      maxDepthRank: evaluation.maxDepthRank,
      unavailableSampleCount: evaluation.unavailableSampleCount,
    },
    ruleVersion: ROUTE_RULE_VERSION,
    dataSourcesUsed: [
      "国土地理院 指定緊急避難場所データ（大阪市）",
      "国土交通省 ハザードマップポータルサイト（洪水浸水想定区域）",
      "openrouteservice（徒歩ルート）",
    ],
  };
}
