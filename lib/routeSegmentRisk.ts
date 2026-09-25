// 避難ルートを区間ごとに評価し、「洪水」「内水氾濫」「地形(周辺より低いか)」を
// 独立した理由として保持したまま、表示用の少数カテゴリ(riskLevel)へ
// 統合するモジュール。
//
// 【重要・このモジュールの位置づけ】
// - 既存の lib/routeHazardEvaluation.ts (評価結果を集計するだけの
//   evaluateRouteFloodHazard())は変更しない。ここでは、その内部で実際に
//   ピクセル単位の判定を行っている classifyHazardPixel() を、洪水・内水氾濫
//   の両方について再利用する(内水氾濫はこれまでルート評価に使われて
//   いなかったが、lib/riskAssessment.ts が現在地判定で全く同じ関数・
//   タイルURL・凡例を使って内水氾濫を判定できることを確認済みのため、
//   ここでも安全に再利用できる)。
// - 標高(地形)はlib/gsiElevationTile.ts・lib/routeTerrainEvaluation.tsに委譲。
// - 「安全」「必ず冠水する」という断定は行わない。統合結果はあくまで
//   参考区間評価(relatively_low/attention/higher_attention/unknown)。
//
// 【安全側の統合方針】
// - unknownは決して「低リスク」として扱わない。
// - terrain(地形)だけでは最高リスク(higher_attention)にしない
//   (洪水・内水のいずれかが高い場合のみhigher_attentionとする)。
// - 区間が「relatively_low」と言えるのは、洪水・内水氾濫の両方を
//   実際に評価できた場合のみ。どちらかが評価不能ならunknownとする
//   (評価できなかった項目があるのに「低リスク」と見せない)。

import { HAZARD_TILE_URL } from "../components/hazardLayers.ts";
import { classifyHazardPixel } from "./hazardPixelClassifier.ts";
import {
  sampleRouteAtInterval,
  haversineDistanceMeters,
  type LatLng,
  type RouteSample,
  type DepthRank,
} from "./routeHazardMath.ts";
import {
  createElevationTileCache,
  getElevationAtPoint,
  type ElevationSource,
  type ElevationTileCache,
  type DemFetchFn,
} from "./gsiElevationTile.ts";
import { evaluateTerrainAtPoint, type TerrainAssessment } from "./routeTerrainEvaluation.ts";

// 【重要】以下は研究用プロトタイプの暫定閾値であり、科学的に確定した値ではない。
// 既存のnotificationDecisionConfig等、他機能の閾値とは独立している。
export const ROUTE_SEGMENT_RISK_CONFIG = {
  /** DepthRank(0〜5, lib/hazardColorLegend.ts)がこの値以上を「一定のハザード」とみなす。 */
  attentionDepthRank: 1,
  /** DepthRank(0〜5)がこの値以上を「高いハザード」とみなす。 */
  higherAttentionDepthRank: 3,
  /** ルートのサンプリング間隔(m)。既存のDEFAULT_SAMPLE_INTERVAL_METERSと揃えている。 */
  sampleIntervalMeters: 30,
} as const;

export type SegmentRiskLevel = "relatively_low" | "attention" | "higher_attention" | "unknown";

export type RouteRiskReason =
  | "flood_hazard_area"
  | "inland_flood_hazard_area"
  | "relatively_low_terrain"
  | "no_significant_hazard"
  | "data_unavailable";

export type DepthRankAssessment = { status: "evaluated"; rank: DepthRank } | { status: "unknown" };

export type RouteRiskSegment = {
  /** 元のルートgeometryをこの区間の距離範囲で分割した実際の座標列(直線近似で建物を横切らないようにするため)。 */
  coordinates: LatLng[];
  startDistanceMeters: number;
  endDistanceMeters: number;
  riskLevel: SegmentRiskLevel;
  reasons: RouteRiskReason[];
  /** この区間内で確認された最大の洪水ハザードrank(評価できた範囲のみ)。 */
  flood: DepthRankAssessment;
  /** この区間内で確認された最大の内水氾濫ハザードrank。 */
  inlandFlood: DepthRankAssessment;
  /** この区間内で最も低かった地点の標高(参考値)。 */
  elevationMeters: number | null;
  elevationSource: ElevationSource;
  /** この区間内で最も「周囲より低い」度合いが大きかった値(負が大きいほど低い)。 */
  relativeElevationMeters: number | null;
};

export type RouteSegmentRiskResult = {
  segments: RouteRiskSegment[];
  sampleIntervalMeters: number;
  sampleCount: number;
  processingTimeMs: number;
};

async function assessHazardAtPoint(hazardTileUrl: string, point: LatLng): Promise<DepthRankAssessment> {
  const pixel = await classifyHazardPixel(hazardTileUrl, point.lat, point.lng);
  if (pixel.status === "hazard") return { status: "evaluated", rank: pixel.rank };
  if (pixel.status === "outside") return { status: "evaluated", rank: 0 };
  return { status: "unknown" };
}

export function combineDepthRank(a: DepthRankAssessment, b: DepthRankAssessment): DepthRankAssessment {
  if (a.status === "unknown" || b.status === "unknown") return { status: "unknown" };
  return { status: "evaluated", rank: Math.max(a.rank, b.rank) as DepthRank };
}

/** 2地点の地形評価から、区間の代表値を作る(より低い=より懸念のある方を採用)。 */
function combineTerrain(
  a: TerrainAssessment,
  b: TerrainAssessment
): { elevationMeters: number | null; elevationSource: ElevationSource; relativeElevationMeters: number | null; isRelativelyLow: boolean } {
  const isRelativelyLow = a.isRelativelyLow || b.isRelativelyLow;
  const relCandidates = [a.relativeElevationMeters, b.relativeElevationMeters].filter(
    (v): v is number => v !== null
  );
  const relativeElevationMeters = relCandidates.length > 0 ? Math.min(...relCandidates) : null;

  const elevCandidates = [a, b].filter((t) => t.elevationMeters !== null);
  if (elevCandidates.length === 0) {
    return { elevationMeters: null, elevationSource: "unknown", relativeElevationMeters, isRelativelyLow };
  }
  const lowest = elevCandidates.reduce((min, t) => (t.elevationMeters! < min.elevationMeters! ? t : min));
  return {
    elevationMeters: lowest.elevationMeters,
    elevationSource: lowest.elevationSource,
    relativeElevationMeters,
    isRelativelyLow,
  };
}

export function determineSegmentRisk(
  flood: DepthRankAssessment,
  inlandFlood: DepthRankAssessment,
  isRelativelyLowTerrain: boolean
): { riskLevel: SegmentRiskLevel; reasons: RouteRiskReason[] } {
  const { attentionDepthRank, higherAttentionDepthRank } = ROUTE_SEGMENT_RISK_CONFIG;
  const floodKnown = flood.status === "evaluated";
  const inlandKnown = inlandFlood.status === "evaluated";

  const floodHigh = floodKnown && flood.rank >= higherAttentionDepthRank;
  const inlandHigh = inlandKnown && inlandFlood.rank >= higherAttentionDepthRank;
  if (floodHigh || inlandHigh) {
    const reasons: RouteRiskReason[] = [];
    if (floodHigh) reasons.push("flood_hazard_area");
    if (inlandHigh) reasons.push("inland_flood_hazard_area");
    return { riskLevel: "higher_attention", reasons };
  }

  const floodSome = floodKnown && flood.rank >= attentionDepthRank;
  const inlandSome = inlandKnown && inlandFlood.rank >= attentionDepthRank;
  if (floodSome || inlandSome || isRelativelyLowTerrain) {
    const reasons: RouteRiskReason[] = [];
    if (floodSome) reasons.push("flood_hazard_area");
    if (inlandSome) reasons.push("inland_flood_hazard_area");
    if (isRelativelyLowTerrain) reasons.push("relatively_low_terrain");
    return { riskLevel: "attention", reasons };
  }

  // 明確なハザードは検出されなかった。「低リスク」と表示するには、
  // 洪水・内水氾濫の両方を実際に評価できている必要がある
  // (unknown != relatively_low。評価できなかった項目を安全側に見せない)。
  if (floodKnown && inlandKnown) {
    return { riskLevel: "relatively_low", reasons: ["no_significant_hazard"] };
  }
  return { riskLevel: "unknown", reasons: ["data_unavailable"] };
}

/**
 * 元のルートgeometry(頂点列)から、道なり距離[startDistanceMeters,
 * endDistanceMeters]の範囲に対応する実際の座標列を切り出す。
 * 【重要】30mごとのサンプル点同士を直線で結ぶのではなく、元のgeometryの
 * 頂点をそのまま使うため、曲がり角で建物を横切って見えるような
 * 単純化は起きない。
 */
export function sliceRouteGeometry(
  geometry: LatLng[],
  startDistanceMeters: number,
  endDistanceMeters: number
): LatLng[] {
  if (geometry.length === 0) return [];
  if (geometry.length === 1) return [geometry[0]];

  const points: LatLng[] = [];
  const pushIfNew = (p: LatLng) => {
    const last = points[points.length - 1];
    if (!last || last.lat !== p.lat || last.lng !== p.lng) points.push(p);
  };
  const interpolate = (a: LatLng, b: LatLng, t: number): LatLng => ({
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
  });

  let cumulative = 0;
  for (let i = 0; i < geometry.length - 1; i++) {
    const segStart = geometry[i];
    const segEnd = geometry[i + 1];
    const segLength = haversineDistanceMeters(segStart, segEnd);
    const segStartDist = cumulative;
    const segEndDist = cumulative + segLength;

    if (segLength > 0 && segEndDist >= startDistanceMeters && segStartDist <= endDistanceMeters) {
      if (segStartDist >= startDistanceMeters) {
        pushIfNew(segStart);
      } else {
        pushIfNew(interpolate(segStart, segEnd, (startDistanceMeters - segStartDist) / segLength));
      }
      if (segEndDist <= endDistanceMeters) {
        pushIfNew(segEnd);
      } else {
        pushIfNew(interpolate(segStart, segEnd, (endDistanceMeters - segStartDist) / segLength));
      }
    }
    cumulative = segEndDist;
  }
  return points;
}

export type SubSegmentAssessment = {
  startDistanceMeters: number;
  endDistanceMeters: number;
  riskLevel: SegmentRiskLevel;
  reasons: RouteRiskReason[];
  flood: DepthRankAssessment;
  inlandFlood: DepthRankAssessment;
  elevationMeters: number | null;
  elevationSource: ElevationSource;
  relativeElevationMeters: number | null;
};

function sameReasons(a: RouteRiskReason[], b: RouteRiskReason[]): boolean {
  // riskLevelが同じであれば統合対象とする(理由の完全一致までは要求しない。
  // 表示上は統合後のセグメント全体から理由を再集約するため)。
  void a;
  void b;
  return true;
}

/** 連続するriskLevelが同じsub-segmentを1つのRouteRiskSegmentへまとめる。 */
export function mergeSubSegments(subSegments: SubSegmentAssessment[], geometry: LatLng[]): RouteRiskSegment[] {
  const merged: RouteRiskSegment[] = [];
  for (const sub of subSegments) {
    const last = merged[merged.length - 1];
    if (last && last.riskLevel === sub.riskLevel && sameReasons(last.reasons, sub.reasons)) {
      last.endDistanceMeters = sub.endDistanceMeters;
      last.flood = combineDepthRank(last.flood, sub.flood);
      last.inlandFlood = combineDepthRank(last.inlandFlood, sub.inlandFlood);
      const relCandidates = [last.relativeElevationMeters, sub.relativeElevationMeters].filter(
        (v): v is number => v !== null
      );
      last.relativeElevationMeters = relCandidates.length > 0 ? Math.min(...relCandidates) : null;
      if (sub.elevationMeters !== null && (last.elevationMeters === null || sub.elevationMeters < last.elevationMeters)) {
        last.elevationMeters = sub.elevationMeters;
        last.elevationSource = sub.elevationSource;
      }
      const reasonSet = new Set([...last.reasons, ...sub.reasons]);
      last.reasons = [...reasonSet];
    } else {
      merged.push({
        coordinates: [],
        startDistanceMeters: sub.startDistanceMeters,
        endDistanceMeters: sub.endDistanceMeters,
        riskLevel: sub.riskLevel,
        reasons: [...sub.reasons],
        flood: sub.flood,
        inlandFlood: sub.inlandFlood,
        elevationMeters: sub.elevationMeters,
        elevationSource: sub.elevationSource,
        relativeElevationMeters: sub.relativeElevationMeters,
      });
    }
  }
  for (const seg of merged) {
    seg.coordinates = sliceRouteGeometry(geometry, seg.startDistanceMeters, seg.endDistanceMeters);
  }
  return merged;
}

export type EvaluateRouteSegmentRiskOptions = {
  intervalMeters?: number;
  /** テスト・アボート判定用。標準はgsiElevationTile.tsのdefaultFetchFn(fetch)を使う。 */
  demFetchFn?: DemFetchFn;
  /** テスト用。省略時は新規作成する(ルート1本ごとに新しいキャッシュ)。 */
  tileCache?: ElevationTileCache;
};

/**
 * ルートgeometryから区間別リスク評価を行うメインの関数。
 * 【重要】この関数自体は例外を投げない設計にしている
 * (内部の各評価が失敗してもunknownとして扱うため)。呼び出し側で
 * ネットワーク致命的エラーを心配する必要はない。
 */
export async function evaluateRouteSegmentRisk(
  geometry: LatLng[],
  options: EvaluateRouteSegmentRiskOptions = {}
): Promise<RouteSegmentRiskResult> {
  const startedAt = Date.now();
  const intervalMeters = options.intervalMeters ?? ROUTE_SEGMENT_RISK_CONFIG.sampleIntervalMeters;
  const tileCache = options.tileCache ?? createElevationTileCache();
  const samples: RouteSample[] = sampleRouteAtInterval(geometry, intervalMeters);

  const lookupElevation = (point: LatLng) => getElevationAtPoint(point.lat, point.lng, tileCache, options.demFetchFn);

  const perSample = await Promise.all(
    samples.map(async (s) => {
      const [flood, inlandFlood, terrain] = await Promise.all([
        assessHazardAtPoint(HAZARD_TILE_URL.flood, s.point),
        assessHazardAtPoint(HAZARD_TILE_URL.inundation, s.point),
        evaluateTerrainAtPoint(s.point, lookupElevation),
      ]);
      return { sample: s, flood, inlandFlood, terrain };
    })
  );

  const subSegments: SubSegmentAssessment[] = [];
  for (let i = 0; i < perSample.length - 1; i++) {
    const a = perSample[i];
    const b = perSample[i + 1];
    const flood = combineDepthRank(a.flood, b.flood);
    const inlandFlood = combineDepthRank(a.inlandFlood, b.inlandFlood);
    const terrain = combineTerrain(a.terrain, b.terrain);
    const { riskLevel, reasons } = determineSegmentRisk(flood, inlandFlood, terrain.isRelativelyLow);
    subSegments.push({
      startDistanceMeters: a.sample.cumulativeDistanceMeters,
      endDistanceMeters: b.sample.cumulativeDistanceMeters,
      riskLevel,
      reasons,
      flood,
      inlandFlood,
      elevationMeters: terrain.elevationMeters,
      elevationSource: terrain.elevationSource,
      relativeElevationMeters: terrain.relativeElevationMeters,
    });
  }

  const segments = mergeSubSegments(subSegments, geometry);

  return {
    segments,
    sampleIntervalMeters: intervalMeters,
    sampleCount: samples.length,
    processingTimeMs: Date.now() - startedAt,
  };
}
