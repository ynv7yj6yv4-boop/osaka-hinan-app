// 要件定義書3「方式A」: lib/hazardPixelClassifier.ts のNode.js版。
//
// 【重要・保守メモ】判定ロジック(interpretTileSample相当)は
// lib/hazardPixelClassifier.ts と完全に同じ規約であり、意図的に複製している。
// 404 = unknown（outsideにしない）等の既存ルールは一切変更していない。
// 新しい判定ロジックは作らず、Node.js版のタイル取得(tilePixelNode.ts)を
// 使って既存の解釈をそのまま再現するだけ。

import { samplePixelFromTileNode, type TileSampleResult } from "./tilePixelNode";
import { matchDepthColor, type DepthRank } from "./hazardColorLegend";

export type HazardPixelStatus =
  | { status: "hazard"; rank: DepthRank }
  | { status: "outside" }
  | { status: "unknown"; reason: "no_tile" | "fetch_error" | "color_unknown" };

export function interpretTileSample(result: TileSampleResult): HazardPixelStatus {
  if (result.kind === "error") return { status: "unknown", reason: "fetch_error" };
  if (result.kind === "no_tile") return { status: "unknown", reason: "no_tile" };

  if (result.a === 0) return { status: "outside" };

  const match = matchDepthColor(result.r, result.g, result.b);
  if (!match.matched) return { status: "unknown", reason: "color_unknown" };

  return { status: "hazard", rank: match.rank };
}

export async function classifyHazardPixelNode(
  urlTemplate: string,
  lat: number,
  lng: number,
  zoom?: number
): Promise<HazardPixelStatus> {
  const result = await samplePixelFromTileNode(urlTemplate, lat, lng, zoom);
  return interpretTileSample(result);
}
