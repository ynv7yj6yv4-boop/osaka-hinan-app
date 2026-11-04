// Phase 4A: 判定ログ（卒業研究としての再現性のための記録構造）
//
// 「どのデータを・いつ取得して・どの条件で・どの危険度を出したか」を
// 後から説明できるよう、判定1回ごとに1つのオブジェクトを生成する。
// Phase4Aでは永続保存（サーバー/DB）はまだ行わない。まずはオブジェクトとして
// 生成できる構造のみを用意する（将来、localStorageやAPI経由での保存に接続する）。

import type { AssessmentCompleteness, RiskFactor, RiskLevel } from "./riskAssessment";
import type { RainfallObservationResult } from "./rainfallObservation";
import type { ForecastRainfallCategory, ForecastRainfallSummary } from "./forecastRainfallRisk";

// 判定ルールを変更した場合はこの値を更新する。
// Phase5A.3: 404等(unknown)をrank0に変換しない解釈に統一したため更新。
// "static-only"は「降雨は判定に未統合、静的ハザードのみでlevelを決定している」ことを表す。
export const RULE_VERSION = "phase5a3-static-only-v2";
// 2026-11: 予想雨量（lib/forecastRainfallRisk.ts）を静的ハザードと組み合わせてlevelを決めた場合のルール。
// 予想雨量を取得できず静的ハザードのみで判定した場合は、従来のRULE_VERSIONを記録する。
export const FORECAST_RULE_VERSION = "static-plus-forecast-v1-provisional";

export type JudgmentLog = {
  judgedAt: string; // 判定を行った時刻（ISO文字列）
  position: { lat: number; lng: number };
  staticHazard: {
    // 各factorのstatus("evaluated"/"unknown")・reason(no_tile/fetch_error/color_unknown)
    // を含む。「どのデータが取得でき、どのデータが取得できなかったか」を再現できる。
    factors: RiskFactor[];
    score: number;
    completeness: AssessmentCompleteness;
  };
  rainfall:
    | {
        status: "observed";
        dataTimeLabel: string;
        fetchedAt: string;
        rank: number | null;
        approxRange: string;
        usedInJudgment: false; // Phase4Aでは常にfalse（表示のみ、判定への統合はしていない）
      }
    | {
        status: "fetch_error";
        fetchedAt: string;
        usedInJudgment: false;
      }
    | {
        status: "not_attempted"; // 何らかの理由で降雨取得自体を行わなかった場合
      };
  /** 2026-11: 今後の予想雨量。取得を試みなかった場合はnull。 */
  forecastRainfall: {
    summary: ForecastRainfallSummary;
    category: ForecastRainfallCategory | null;
    usedInJudgment: boolean;
  } | null;
  ruleVersion: string;
  finalResult: {
    level: RiskLevel;
    score: number;
  };
  reasons: string[];
};

export function buildJudgmentLog(params: {
  position: { lat: number; lng: number };
  staticFactors: RiskFactor[];
  staticScore: number;
  completeness: AssessmentCompleteness;
  rainfall: RainfallObservationResult | null;
  level: RiskLevel;
  reasons: string[];
  forecastRainfall?: JudgmentLog["forecastRainfall"];
}): JudgmentLog {
  const { position, staticFactors, staticScore, completeness, rainfall, level, reasons } = params;
  const forecastRainfall = params.forecastRainfall ?? null;

  const rainfallLog: JudgmentLog["rainfall"] = !rainfall
    ? { status: "not_attempted" }
    : rainfall.status === "observed"
      ? {
          status: "observed",
          dataTimeLabel: rainfall.dataTimeLabel,
          fetchedAt: rainfall.fetchedAt,
          rank: rainfall.rank,
          approxRange: rainfall.approxRange,
          usedInJudgment: false,
        }
      : { status: "fetch_error", fetchedAt: rainfall.fetchedAt, usedInJudgment: false };

  return {
    judgedAt: new Date().toISOString(),
    position,
    staticHazard: { factors: staticFactors, score: staticScore, completeness },
    rainfall: rainfallLog,
    forecastRainfall,
    ruleVersion: forecastRainfall?.usedInJudgment ? FORECAST_RULE_VERSION : RULE_VERSION,
    finalResult: { level, score: staticScore },
    reasons,
  };
}
