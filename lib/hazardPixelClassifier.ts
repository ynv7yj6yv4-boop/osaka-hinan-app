// Phase 5A.3: Phase3（現在地単体の判定）とPhase5（ルート評価）で共通して使う、
// ハザードタイルのピクセル判定ロジック。
//
// 【この統一の経緯】
// Phase5A.2の監査で、同じ404という結果について、
// - Phase3は「区域外の可能性が高い」としてスコアに算入（rank0）
// - Phase5は「評価不能」として除外
// という解釈の不一致が見つかった。ハザードマップポータルサイトの公式資料からは
// 「404が区域外を意味するのかデータ未整備を意味するのか」を断定できなかったため、
// 本モジュールでは保守的に、両者とも「unknown（判定できない）」として扱う
// 方針に統一する。404を理由に「区域外」「洪水リスクなし」等と断定しない。
//
// 【状態の区別】
// - "hazard": タイルが正常に取得でき、凡例と一致する色が検出された（想定区域内）
// - "outside": タイルが正常に取得でき、透明ピクセル（alpha=0）だった
//              （＝そのタイルの供給範囲内で、対象地点には着色がないことを確認できた）
// - "unknown": 上記いずれでもない。理由をreasonに保持する
//     - "no_tile": タイル自体が存在しない（404）
//     - "fetch_error": 通信エラー・画像デコード失敗等
//     - "color_unknown": ピクセルは取得できたが、凡例と一致する色ではなかった

import { samplePixelFromTile, type TileSampleResult } from "./tilePixel.ts";
import { matchDepthColor, type DepthRank } from "./hazardColorLegend.ts";

export type HazardPixelStatus =
  | { status: "hazard"; rank: DepthRank }
  | { status: "outside" }
  | { status: "unknown"; reason: "no_tile" | "fetch_error" | "color_unknown" };

/**
 * 既に取得済みの TileSampleResult を解釈する（純粋関数・ネットワーク不要）。
 * 単体テスト（lib/hazardPixelClassifier.test.ts）はこの関数を対象にしている。
 */
export function interpretTileSample(result: TileSampleResult): HazardPixelStatus {
  if (result.kind === "error") return { status: "unknown", reason: "fetch_error" };
  if (result.kind === "no_tile") return { status: "unknown", reason: "no_tile" };

  // kind === "pixel"
  if (result.a === 0) return { status: "outside" };

  const match = matchDepthColor(result.r, result.g, result.b);
  if (!match.matched) return { status: "unknown", reason: "color_unknown" };

  return { status: "hazard", rank: match.rank };
}

/**
 * 指定URLテンプレートのタイルから、指定地点のハザード状態を取得・解釈する（I/Oあり）。
 */
export async function classifyHazardPixel(
  urlTemplate: string,
  lat: number,
  lng: number,
  zoom?: number
): Promise<HazardPixelStatus> {
  const result = await samplePixelFromTile(urlTemplate, lat, lng, zoom);
  return interpretTileSample(result);
}
