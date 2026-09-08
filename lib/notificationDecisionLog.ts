// 試作3 通知判定ロジック設計 PART14・17: 通知判定の研究ログ。
//
// 既存のJudgmentLog(lib/judgmentLog.ts)・RouteJudgmentLog
// (lib/routeJudgmentLog.ts)と同じ考え方で、「通知を送った/送らなかった
// 理由」を後から検証できるようにする（要件定義書2 PART14「通知しない
// 理由もログへ記録できるようにする」・PART17「検証方法」に対応）。
//
// 【重要】ここには位置の継続履歴（GPS移動ログ）は含めない。監視地点1件・
// 1回の評価につき1レコード。

import type { NotificationDecisionResult } from "./notificationDecision";

export type NotificationDecisionLogEntry = {
  evaluatedAt: string;
  monitoringPointId: string;
  decisionVersion: string;
  /** この評価に使った各入力の要約（値そのものではなく、比較・検証用の要約） */
  inputs: {
    staticFloodHazardStatus: "evaluated" | "unknown";
    staticFloodHazardDepthRank: number | null;
    rainfallForecastStatus: "forecast" | "unavailable";
    rainfallForecastRank: number | null;
    dataCompleteness: "complete" | "partial" | "unavailable";
  };
  result: NotificationDecisionResult;
};

export function buildNotificationDecisionLogEntry(params: {
  monitoringPointId: string;
  decisionVersion: string;
  staticFloodHazardStatus: "evaluated" | "unknown";
  staticFloodHazardDepthRank: number | null;
  rainfallForecastStatus: "forecast" | "unavailable";
  rainfallForecastRank: number | null;
  dataCompleteness: "complete" | "partial" | "unavailable";
  result: NotificationDecisionResult;
}): NotificationDecisionLogEntry {
  return {
    evaluatedAt: new Date().toISOString(),
    monitoringPointId: params.monitoringPointId,
    decisionVersion: params.decisionVersion,
    inputs: {
      staticFloodHazardStatus: params.staticFloodHazardStatus,
      staticFloodHazardDepthRank: params.staticFloodHazardDepthRank,
      rainfallForecastStatus: params.rainfallForecastStatus,
      rainfallForecastRank: params.rainfallForecastRank,
      dataCompleteness: params.dataCompleteness,
    },
    result: params.result,
  };
}

// PART17: 過去データ・保存済み予報を使った検証のための集計ヘルパー
// （notification frequencyを評価指標に含める）。
export type NotificationFrequencyStats = {
  totalEvaluations: number;
  candidateCount: number;
  noNotificationCount: number;
  insufficientDataCount: number;
  cooldownCount: number;
  errorCount: number;
  /** candidateCount / totalEvaluations。「通知が多すぎないか」を見る簡易指標 */
  candidateRatio: number | null;
};

export function summarizeNotificationFrequency(
  entries: NotificationDecisionLogEntry[]
): NotificationFrequencyStats {
  const stats: NotificationFrequencyStats = {
    totalEvaluations: entries.length,
    candidateCount: 0,
    noNotificationCount: 0,
    insufficientDataCount: 0,
    cooldownCount: 0,
    errorCount: 0,
    candidateRatio: null,
  };

  for (const entry of entries) {
    switch (entry.result.type) {
      case "candidate":
        stats.candidateCount++;
        break;
      case "no_notification":
        stats.noNotificationCount++;
        break;
      case "insufficient_data":
        stats.insufficientDataCount++;
        break;
      case "cooldown":
        stats.cooldownCount++;
        break;
      case "error":
        stats.errorCount++;
        break;
    }
  }

  stats.candidateRatio = stats.totalEvaluations > 0 ? stats.candidateCount / stats.totalEvaluations : null;
  return stats;
}
