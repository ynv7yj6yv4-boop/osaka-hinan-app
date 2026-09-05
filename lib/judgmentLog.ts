// Phase 4A: 判定ログ（卒業研究としての再現性のための記録構造）
//
// 「どのデータを・いつ取得して・どの条件で・どの危険度を出したか」を
// 後から説明できるよう、判定1回ごとに1つのオブジェクトを生成する。
// Phase4Aでは永続保存（サーバー/DB）はまだ行わない。まずはオブジェクトとして
// 生成できる構造のみを用意する（将来、localStorageやAPI経由での保存に接続する）。

import type { RiskFactor, RiskLevel } from "./riskAssessment";
import type { RainfallObservationResult } from "./rainfallObservation";

// 判定ルールを変更した場合はこの値を更新する。
// "static-only"は「降雨は判定に未統合、静的ハザードのみでlevelを決定している」ことを表す。
export const RULE_VERSION = "phase4a-static-only-v1";

export type JudgmentLog = {
  judgedAt: string; // 判定を行った時刻（ISO文字列）
  position: { lat: number; lng: number };
  staticHazard: {
    factors: RiskFactor[];
    score: number;
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
  rainfall: RainfallObservationResult | null;
  level: RiskLevel;
  reasons: string[];
}): JudgmentLog {
  const { position, staticFactors, staticScore, rainfall, level, reasons } = params;

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
    staticHazard: { factors: staticFactors, score: staticScore },
    rainfall: rainfallLog,
    ruleVersion: RULE_VERSION,
    finalResult: { level, score: staticScore },
    reasons,
  };
}
