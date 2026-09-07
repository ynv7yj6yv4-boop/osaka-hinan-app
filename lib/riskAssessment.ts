// Phase 3: 現在地の災害リスク判定（ルールベース）
//
// 設計方針（ユーザーとの合意事項）:
// - 洪水・内水氾濫のハザードタイル画像の色を読み取り、浸水深ランクを判定する
//   （試作2以降、高潮は研究対象から除外したためRiskLevel算出には使用しない。
//   下記assessRisk内のhazardKeys参照。データ・タイル取得ロジック自体は
//   components/hazardLayers.ts に残しており、削除はしていない）
// - リアルタイムの降雨・河川水位・気象警報は「まだ使えないデータ」として明示し、
//   将来のPhaseで追加できるよう、判定要素(RiskFactor)を配列で拡張できる構造にしている
// - 現時点ではリアルタイム情報が無いため、🔴（最高リスク）は使用せず🟠までに抑える
//   （晴天時に静的なハザードマップだけで最大級の警告を出すと誤解を招くため）
// - 表示文言は「現在の降雨状況を考慮していない、静的なハザード情報に基づく評価」
//   であることが伝わるよう、行動を指示する言い回し（「避難準備」等）を避け、
//   リスクの高さを表す言い回しにしている（内部の型名・キー名は変更していない）

import { HAZARD_BUTTONS, HAZARD_TILE_URL, type HazardKey } from "@/components/hazardLayers";
import { classifyHazardPixel, type HazardPixelStatus } from "./hazardPixelClassifier";
import type { DepthRank } from "./hazardColorLegend";
import { fetchElevation } from "./elevation";
import { fetchRainfallObservation, type RainfallObservationResult } from "./rainfallObservation";
import { buildJudgmentLog, type JudgmentLog } from "./judgmentLog";

export type RiskLevel = "unknown" | "safe" | "caution" | "prepare" | "evacuate";

export const RISK_LEVEL_INFO: Record<
  RiskLevel,
  { emoji: string; label: string; color: string; bgColor: string }
> = {
  unknown: { emoji: "⚪", label: "判定情報不足", color: "#52525b", bgColor: "#f4f4f5" },
  // Phase5A.3: 静的なハザードマップだけから「安全」と断定しないよう、
  // 一部のハザードが未確認(unknown)の場合にも誤解を招かない表現に変更した。
  safe: { emoji: "🟢", label: "低リスク", color: "#15803d", bgColor: "#f0fdf4" },
  caution: { emoji: "🟡", label: "注意", color: "#a16207", bgColor: "#fefce8" },
  prepare: { emoji: "🟠", label: "高リスク", color: "#c2410c", bgColor: "#fff7ed" },
  // Phase3時点では到達しない（Phase4でリアルタイム降雨等と連動してから有効化する想定）
  evacuate: { emoji: "🔴", label: "最高リスク", color: "#b91c1c", bgColor: "#fef2f2" },
};

// Phase5A.3: lib/hazardPixelClassifier.ts の共通状態(HazardPixelStatus)をそのまま使う。
// 以前は独自の5値（confirmed_risk/confirmed_clear/no_tile_data/unrecognized_color/
// fetch_error）を持っていたが、Phase5（ルート評価）との解釈統一のため、
// 判定できた場合は "evaluated"、できなかった場合は "unknown"（理由付き）という
// 共通の形に揃えた。
export type HazardFactorStatus =
  | "evaluated" // hazard または outside。区域内/区域外を確認できた
  | "unknown"; // 判定できなかった（理由はreasonを参照。断定はしない）

export type AssessmentCompleteness = "complete" | "partial" | "unavailable";

export type RiskFactor = {
  key: string;
  label: string;
  available: boolean;
  detail: string;
  score: number; // 総合スコアへの寄与（利用不可の場合は0）
  // Phase5A.3: 卒業研究としての再現性のため、判定できたかどうかとその理由を保持する
  status?: HazardFactorStatus;
  reason?: "no_tile" | "fetch_error" | "color_unknown";
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
  // Phase5A.3: 洪水・内水氾濫のうち、何件を実際に判定できたかを示す
  // （試作2で高潮を対象から除外したため、Phase5A.3時点の「3件中」から
  //   「2件中」に変わった。下記assessRisk内のhazardKeys参照）。
  // "unavailable"（全件unknown）の場合、levelは"unknown"になる。
  // "partial"の場合でも、判定できたハザードの情報でlevelを算出する
  // （unknownの存在によって既知のリスクを引き下げない）。
  assessmentCompleteness: AssessmentCompleteness;
  // Phase4A: 現在の降雨実況（参考情報）。
  // 重要: staticRisk（上記level/score/factors/reasons）は降雨の影響を受けない。
  // 「静的には高リスクだが今は降っていない」等を区別できるよう、常に別枠で保持する。
  rainfall: RainfallObservationResult;
  judgmentLog: JudgmentLog;
};

const HAZARD_LABELS: Record<HazardKey, string> = Object.fromEntries(
  HAZARD_BUTTONS.map((h) => [h.key, h.label])
) as Record<HazardKey, string>;

type HazardAssessment = {
  status: HazardFactorStatus;
  rank: DepthRank;
  depthLabel?: string;
  reason?: "no_tile" | "fetch_error" | "color_unknown";
};

function toHazardAssessment(pixel: HazardPixelStatus): HazardAssessment {
  if (pixel.status === "hazard") {
    const DEPTH_LABELS: Record<DepthRank, string> = {
      0: "",
      1: "0.5m未満",
      2: "0.5m〜3.0m",
      3: "3.0m〜5.0m",
      4: "5.0m〜10.0m",
      5: "10.0m以上",
    };
    return { status: "evaluated", rank: pixel.rank, depthLabel: DEPTH_LABELS[pixel.rank] };
  }
  if (pixel.status === "outside") {
    return { status: "evaluated", rank: 0 };
  }
  // unknown（no_tile / fetch_error / color_unknown）
  return { status: "unknown", rank: 0, reason: pixel.reason };
}

async function assessHazard(hazard: HazardKey, lat: number, lng: number): Promise<HazardAssessment> {
  const pixel = await classifyHazardPixel(HAZARD_TILE_URL[hazard], lat, lng);
  return toHazardAssessment(pixel);
}

function hazardReasonText(hazard: HazardKey, r: HazardAssessment): string {
  const label = HAZARD_LABELS[hazard];
  if (r.status === "evaluated") {
    return r.rank > 0
      ? `${label}浸水想定区域内（想定浸水深：${r.depthLabel}）`
      : `${label}：想定区域外`;
  }
  // unknown: 404等を理由に「区域外」「安全」と断定しない。原因は問わずユーザー向けには
  // 一律の文言にする（研究ログにはreasonをそのまま残す）。
  return `${label}：ハザード情報を確認できません`;
}

// スコア → 危険度（Phase3では🔴を使わず🟠までに抑える）
function scoreToLevel(score: number): RiskLevel {
  if (score <= 0) return "safe";
  if (score === 1) return "caution";
  return "prepare"; // 2以上はすべて「高リスク」までに抑える（🔴最高リスクはPhase4以降）
}

// 「今すぐ避難しなければならない」という誤解を避けるため、
// あくまでハザードマップ（想定）に基づく参考情報であることが伝わる言い回しにしている。
const RECOMMENDATION_TEXT: Record<RiskLevel, string> = {
  // Phase5A.3: 「通信エラー」に限定しない文言に修正（データ未整備等、原因は複数ありうる）
  unknown:
    "洪水・内水氾濫のいずれについても、ハザード情報を確認できませんでした（通信環境の問題、またはこの地点のデータが整備されていない可能性があります）。地図上のハザード表示を目視でご確認いただくか、しばらくしてから再度お試しください。",
  safe: "ハザードマップ上では大きな浸水リスクは確認されていません。念のため、今後の気象情報にも注意しておきましょう。",
  caution:
    "ハザードマップ上でわずかな浸水リスクが想定されています。今後の気象情報に注意し、お住まいの地域の避難場所や避難経路を事前に確認しておきましょう。",
  prepare:
    "この場所はハザードマップ上で浸水想定区域に含まれています。今後の気象情報や大阪市等の公式避難情報を確認し、災害発生時は早めの避難を検討してください。",
  evacuate: "この場所は特に深刻な浸水が想定されています。災害発生時は速やかな避難を検討してください。",
};

export async function assessRisk(lat: number, lng: number): Promise<RiskResult> {
  // 試作2（要件定義書2 §5・§31③）: 高潮を研究対象から除外したため、
  // RiskLevel・assessmentCompletenessの算出対象は洪水・内水氾濫の2つのみとする。
  // 【重要】これはUI表示だけを隠すのではなく、算出そのものから高潮を外すことで、
  // 「画面に出ないだけで内部判定には使われている」状態を防ぐための変更。
  // 高潮のタイルURL・判定関数自体は components/hazardLayers.ts に残している
  // （完全削除はしない。将来的な再対応や他機能からの参照に備える）。
  const hazardKeys: HazardKey[] = ["flood", "inundation"];

  // 静的ハザード判定・標高・降雨実況は互いに独立しているため並行取得する。
  // 降雨の取得に失敗しても、静的ハザード判定（Phase3の評価）には一切影響しない。
  const [hazardResults, elevation, rainfall] = await Promise.all([
    Promise.all(hazardKeys.map((key) => assessHazard(key, lat, lng))),
    fetchElevation(lat, lng),
    fetchRainfallObservation(lat, lng),
  ]);

  const factors: RiskFactor[] = [];
  const reasons: string[] = [];
  let maxRank = 0;
  let determinedCount = 0;

  // Phase5A.3: 404等(unknown)はもはや「区域外の可能性が高い」として算入しない
  // （Phase5A.2の監査で発覚したPhase3/Phase5の解釈不一致の是正。Phase5側の
  //   保守的な解釈に統一する）。判定できた(evaluated)ハザードのみでスコアを決める。
  // 重要: 一部のハザードがunknownでも、判定できた他のハザードの情報は失われない
  // （例: 洪水=判定成功・内水氾濫=unknown なら、洪水の情報でlevelを決め、
  //   内水氾濫は「確認できません」として別途表示するのみ）。
  hazardKeys.forEach((key, i) => {
    const r = hazardResults[i];
    if (r.status === "evaluated") {
      determinedCount++;
      maxRank = Math.max(maxRank, r.rank);
    }
    factors.push({
      key,
      label: HAZARD_LABELS[key],
      available: r.status === "evaluated",
      detail: hazardReasonText(key, r),
      score: r.rank,
      status: r.status,
      reason: r.reason,
    });
    reasons.push(hazardReasonText(key, r));
  });

  const assessmentCompleteness: AssessmentCompleteness =
    determinedCount === hazardKeys.length ? "complete" : determinedCount === 0 ? "unavailable" : "partial";

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

  // Phase4A: 現在の降雨実況は「取得・表示」のみ行い、危険度スコアには含めない
  // （色→mm/hの対応関係が状況証拠の組み合わせによる推定であり、
  //   スコアへ組み込むだけの確度がないと判断したため。lib/rainfallColorLegend.ts参照）
  factors.push({
    key: "rainfall",
    label: "現在の降雨",
    available: rainfall.status === "observed",
    detail:
      rainfall.status === "observed"
        ? `現在の降雨（${rainfall.dataTimeLabel}時点、気象庁レーダーによる目安）：${rainfall.approxRange}※このリスク評価には反映していません`
        : "現在の降雨データを取得できないため、降雨状況は判定に反映していません",
    score: 0,
  });

  const disclaimers = [
    "これはハザードマップ等の静的な情報に基づくアプリ独自の参考評価であり、公式の避難情報ではありません。",
    "大雨が実際に発生した場合を想定したハザードマップに基づく評価です。現在の降雨状況（表示している場合も含む）は、この危険度の判定には反映していません。",
  ];
  if (assessmentCompleteness === "partial") {
    disclaimers.push(
      "洪水・内水氾濫の一部について、ハザード情報を確認できませんでした。表示している危険度は、確認できた情報のみに基づいています。"
    );
  }

  const level: RiskLevel = assessmentCompleteness === "unavailable" ? "unknown" : scoreToLevel(maxRank);

  const judgmentLog = buildJudgmentLog({
    position: { lat, lng },
    staticFactors: factors,
    staticScore: maxRank,
    completeness: assessmentCompleteness,
    rainfall,
    level,
    reasons,
  });

  return {
    level,
    score: maxRank,
    factors,
    reasons,
    recommendation: RECOMMENDATION_TEXT[level],
    disclaimers,
    position: { lat, lng },
    generatedAt: new Date().toISOString(),
    assessmentCompleteness,
    rainfall,
    judgmentLog,
  };
}
