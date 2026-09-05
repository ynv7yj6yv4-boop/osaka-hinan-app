// Phase 3: 現在地の危険度判定（ルールベース）
//
// 設計方針（ユーザーとの合意事項）:
// - 洪水・内水氾濫・高潮のハザードタイル画像の色を読み取り、浸水深ランクを判定する
// - リアルタイムの降雨・河川水位・気象警報は「まだ使えないデータ」として明示し、
//   将来のPhaseで追加できるよう、判定要素(RiskFactor)を配列で拡張できる構造にしている
// - 現時点ではリアルタイム情報が無いため、🔴（直ちに避難）は使用せず🟠までに抑える
//   （晴天時に静的なハザードマップだけで最大級の警告を出すと誤解を招くため）

import { HAZARD_BUTTONS, HAZARD_TILE_URL, type HazardKey } from "@/components/hazardLayers";
import { matchDepthColor, type DepthRank } from "./hazardColorLegend";
import { samplePixelFromTile } from "./tilePixel";
import { fetchElevation } from "./elevation";

export type RiskLevel = "unknown" | "safe" | "caution" | "prepare" | "evacuate";

export const RISK_LEVEL_INFO: Record<
  RiskLevel,
  { emoji: string; label: string; color: string; bgColor: string }
> = {
  unknown: { emoji: "⚪", label: "判定不可", color: "#52525b", bgColor: "#f4f4f5" },
  safe: { emoji: "🟢", label: "安全", color: "#15803d", bgColor: "#f0fdf4" },
  caution: { emoji: "🟡", label: "注意", color: "#a16207", bgColor: "#fefce8" },
  prepare: { emoji: "🟠", label: "避難準備", color: "#c2410c", bgColor: "#fff7ed" },
  // Phase3時点では到達しない（Phase4でリアルタイム降雨等と連動してから有効化する想定）
  evacuate: { emoji: "🔴", label: "直ちに避難", color: "#b91c1c", bgColor: "#fef2f2" },
};

export type HazardFactorStatus =
  | "confirmed_risk" // ハザード想定区域内であることを確認
  | "confirmed_clear" // 有効なタイル内で「区域外」であることを確認
  | "no_tile_data" // タイル自体が存在せず、区域外か未整備か判別できない
  | "unrecognized_color" // 色は検出したが凡例と一致しない
  | "fetch_error"; // 通信エラー等で確認できなかった

export type RiskFactor = {
  key: string;
  label: string;
  available: boolean;
  detail: string;
  score: number; // 総合スコアへの寄与（利用不可の場合は0）
};

export type RiskResult = {
  level: RiskLevel;
  score: number;
  factors: RiskFactor[];
  reasons: string[];
  recommendation: string;
  disclaimers: string[];
  position: { lat: number; lng: number };
  generatedAt: string;
};

const HAZARD_LABELS: Record<HazardKey, string> = Object.fromEntries(
  HAZARD_BUTTONS.map((h) => [h.key, h.label])
) as Record<HazardKey, string>;

async function assessHazard(
  hazard: HazardKey,
  lat: number,
  lng: number
): Promise<{ status: HazardFactorStatus; rank: DepthRank; depthLabel?: string }> {
  const result = await samplePixelFromTile(HAZARD_TILE_URL[hazard], lat, lng);

  if (result.kind === "error") return { status: "fetch_error", rank: 0 };
  if (result.kind === "no_tile") return { status: "no_tile_data", rank: 0 };

  // kind === "pixel"
  if (result.a === 0) return { status: "confirmed_clear", rank: 0 };

  const match = matchDepthColor(result.r, result.g, result.b);
  if (!match.matched) return { status: "unrecognized_color", rank: 0 };

  return { status: "confirmed_risk", rank: match.rank, depthLabel: match.label };
}

function hazardReasonText(hazard: HazardKey, r: Awaited<ReturnType<typeof assessHazard>>): string {
  const label = HAZARD_LABELS[hazard];
  switch (r.status) {
    case "confirmed_risk":
      return `${label}浸水想定区域内（想定浸水深：${r.depthLabel}）`;
    case "confirmed_clear":
      return `${label}：想定区域外`;
    case "no_tile_data":
      return `${label}：想定区域外の可能性が高いですが、この地点はデータが未整備の場合があります`;
    case "unrecognized_color":
      return `${label}：地図の色を正しく判別できませんでした（詳細は地図で目視確認してください）`;
    case "fetch_error":
      return `${label}：データを取得できませんでした（通信環境をご確認ください）`;
  }
}

// スコア → 危険度（Phase3では🔴を使わず🟠までに抑える）
function scoreToLevel(score: number): RiskLevel {
  if (score <= 0) return "safe";
  if (score === 1) return "caution";
  return "prepare"; // 2以上はすべて「避難準備」までに抑える
}

const RECOMMENDATION_TEXT: Record<RiskLevel, string> = {
  unknown:
    "データを取得できなかったため判定できませんでした。通信環境をご確認のうえ再度お試しいただくか、地図上のハザード表示をご確認ください。",
  safe: "現時点で大きな浸水リスクは確認されていません。念のため、今後の気象情報にも注意しておきましょう。",
  caution: "今後の気象情報に注意し、お住まいの地域の避難場所や避難経路を事前に確認しておきましょう。",
  prepare:
    "今後の気象情報や大阪市等の公式避難情報を確認し、必要に応じて早めの避難を検討してください。",
  evacuate: "直ちに安全な場所への避難を検討してください。",
};

export async function assessRisk(lat: number, lng: number): Promise<RiskResult> {
  const hazardKeys: HazardKey[] = ["flood", "inundation", "hightide"];

  const [hazardResults, elevation] = await Promise.all([
    Promise.all(hazardKeys.map((key) => assessHazard(key, lat, lng))),
    fetchElevation(lat, lng),
  ]);

  const factors: RiskFactor[] = [];
  const reasons: string[] = [];
  let maxRank = 0;
  let anyDetermined = false;

  hazardKeys.forEach((key, i) => {
    const r = hazardResults[i];
    // "no_tile_data"（タイルが存在しない）は、山間部など元々ハザード想定の対象外である
    // 可能性が高いケースを含むため、「区域外」相当の判定として扱う。
    // （理由文では「データ未整備の可能性」を明記し、断定はしない）
    // 一方 "fetch_error"（通信失敗）や "unrecognized_color" は本当に確認できなかった場合。
    if (r.status === "confirmed_risk" || r.status === "confirmed_clear" || r.status === "no_tile_data") {
      anyDetermined = true;
      maxRank = Math.max(maxRank, r.rank);
    }
    factors.push({
      key,
      label: HAZARD_LABELS[key],
      available: r.status === "confirmed_risk" || r.status === "confirmed_clear",
      detail: hazardReasonText(key, r),
      score: r.rank,
    });
    reasons.push(hazardReasonText(key, r));
  });

  if (elevation.available) {
    factors.push({
      key: "elevation",
      label: "標高",
      available: true,
      detail: `標高：約${elevation.elevation}m（参考情報。判定スコアには使用していません）`,
      score: 0,
    });
    reasons.push(`標高：約${elevation.elevation}m`);
  } else {
    factors.push({
      key: "elevation",
      label: "標高",
      available: false,
      detail: "標高：取得できませんでした（参考情報のため判定への影響はありません）",
      score: 0,
    });
  }

  // 将来Phaseで追加する判定要素の置き場所（今は「利用不可」として明示するのみ）
  factors.push({
    key: "rainfall",
    label: "リアルタイム降雨",
    available: false,
    detail: "リアルタイム降雨：今後のPhaseで対応予定のため、今回の判定には含まれていません",
    score: 0,
  });

  const disclaimers = [
    "これはアプリ独自の参考評価であり、公式の避難情報ではありません。",
    "大雨や高潮が実際に発生した場合を想定したハザードマップに基づく評価です。現在の降雨状況は考慮されていません。",
  ];

  const level: RiskLevel = anyDetermined ? scoreToLevel(maxRank) : "unknown";

  return {
    level,
    score: maxRank,
    factors,
    reasons,
    recommendation: RECOMMENDATION_TEXT[level],
    disclaimers,
    position: { lat, lng },
    generatedAt: new Date().toISOString(),
  };
}
