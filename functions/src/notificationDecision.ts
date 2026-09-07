// 【重要・保守メモ】このファイルは Next.js アプリ側の lib/notificationDecision.ts
// と判定ロジックを同期させること（コピー管理の理由はnotificationDecisionConfig.ts
// 冒頭コメント参照）。
//
// 試作3 PART 3（要件定義書2 PART 10）: 通知判定の独立モジュール。
// 現在地の危険度判定(Next.jsアプリのRiskLevel)とは完全に別ロジックである。

import { notificationDecisionConfig, type NotificationDecisionConfig } from "./notificationDecisionConfig";

export type StaticFloodHazardInput = {
  status: "evaluated" | "unknown";
  depthRank: 0 | 1 | 2 | 3 | 4 | 5;
};

export type RainfallForecastInput = {
  status: "forecast" | "unavailable";
  rank: number | null;
  leadTimeMinutes: number | null;
};

export type DataCompleteness = "complete" | "partial" | "unavailable";

export type PreviousNotificationState = {
  lastNotificationState: "sent" | "not_sent" | null;
  lastNotifiedAt: string | null;
};

export type NotificationDecisionResult =
  | { type: "no_notification"; reason: string }
  | { type: "candidate"; reason: string; decisionVersion: string }
  | { type: "insufficient_data"; reason: string }
  | { type: "cooldown"; reason: string; nextEligibleAt: string | null }
  | { type: "error"; reason: string };

export function evaluateNotificationDecision(input: {
  staticFloodHazard: StaticFloodHazardInput;
  rainfallForecast: RainfallForecastInput;
  dataCompleteness: DataCompleteness;
  previousNotificationState: PreviousNotificationState;
  now?: Date;
  config?: NotificationDecisionConfig;
}): NotificationDecisionResult {
  const config = input.config ?? notificationDecisionConfig;
  const now = input.now ?? new Date();

  // 【最優先・多重防御】マスタースイッチがfalseの間は、他の条件に関わらず
  // 実際の送信につながる"candidate"を一切返さない。
  if (!config.enabled) {
    return {
      type: "no_notification",
      reason: "notificationDecisionConfig.enabled=false（通知条件はまだ人間の承認前です）",
    };
  }

  if (input.dataCompleteness === "unavailable") {
    return { type: "insufficient_data", reason: "静的ハザード情報・降雨予測のいずれも確認できませんでした" };
  }
  if (input.staticFloodHazard.status === "unknown") {
    return { type: "insufficient_data", reason: "静的な洪水ハザード情報を確認できませんでした" };
  }
  if (input.rainfallForecast.status === "unavailable" || input.rainfallForecast.rank === null) {
    return { type: "insufficient_data", reason: "降雨予測を確認できませんでした" };
  }

  if (input.previousNotificationState.lastNotifiedAt) {
    const lastNotifiedMs = new Date(input.previousNotificationState.lastNotifiedAt).getTime();
    const elapsedMinutes = (now.getTime() - lastNotifiedMs) / 60000;
    if (elapsedMinutes < config.cooldownMinutes) {
      return {
        type: "cooldown",
        reason: `前回の通知から${config.cooldownMinutes}分経過していません`,
        nextEligibleAt: new Date(lastNotifiedMs + config.cooldownMinutes * 60000).toISOString(),
      };
    }
  }

  const hazardMatches = input.staticFloodHazard.depthRank >= config.hazardDepthRankThreshold;
  const rainfallMatches = input.rainfallForecast.rank >= config.rainfallRankThreshold;

  if (hazardMatches && rainfallMatches) {
    return {
      type: "candidate",
      reason: `静的洪水ハザード(depthRank=${input.staticFloodHazard.depthRank}) かつ 降雨予測(rank=${input.rainfallForecast.rank})が現在の候補条件を満たしました`,
      decisionVersion: config.decisionVersion,
    };
  }

  return { type: "no_notification", reason: "現在の候補条件を満たしませんでした" };
}
