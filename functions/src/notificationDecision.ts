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

// 要件定義書3: 「これから降り続けると予測される総雨量」ベースの判定用入力。
// lib/floodRiskForecast.ts(Next.js側)/rainfallForecastOpenMeteo.ts(このファイルと
// 同じ複製方針でfunctions/src/へ複製済み)の結果をそのまま渡す。
export type TotalPredictedRainfallInput = {
  status: "evaluated" | "unavailable";
  totalPredictedRainfallMm: number | null;
  windowHours: number | null;
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

  const cooldown = checkCooldown(input.previousNotificationState, config, now);
  if (cooldown) return cooldown;

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

function checkCooldown(
  previousNotificationState: PreviousNotificationState,
  config: NotificationDecisionConfig,
  now: Date
): Extract<NotificationDecisionResult, { type: "cooldown" }> | null {
  if (!previousNotificationState.lastNotifiedAt) return null;
  const lastNotifiedMs = new Date(previousNotificationState.lastNotifiedAt).getTime();
  const elapsedMinutes = (now.getTime() - lastNotifiedMs) / 60000;
  if (elapsedMinutes >= config.cooldownMinutes) return null;
  return {
    type: "cooldown",
    reason: `前回の通知から${config.cooldownMinutes}分経過していません`,
    nextEligibleAt: new Date(lastNotifiedMs + config.cooldownMinutes * 60000).toISOString(),
  };
}

/**
 * 要件定義書3: このアプリの中心的な設計思想を実装した通知判定。
 * 「大雨が予測されたので通知する」のではなく、「これから降り続けると予測される
 * 総雨量が、静的ハザード想定区域内で道路の冠水を引き起こしうる規模かどうか」を
 * 判断してから通知する。evaluateNotificationDecision()（その瞬間の降雨の強さ=
 * rankを使う旧来の判定）とは別の判定として共存させる。
 *
 * 【重要な限界】totalPredictedRainfallMmが閾値を超えることは、あくまで
 * 研究上の代理指標(proxy)であり、実際にその地点の道路が冠水することを
 * 検証済みの物理モデル・実測データに基づいて判定するものではない。
 */
export function evaluateFloodRiskNotificationDecision(input: {
  staticFloodHazard: StaticFloodHazardInput;
  totalPredictedRainfall: TotalPredictedRainfallInput;
  dataCompleteness: DataCompleteness;
  previousNotificationState: PreviousNotificationState;
  now?: Date;
  config?: NotificationDecisionConfig;
}): NotificationDecisionResult {
  const config = input.config ?? notificationDecisionConfig;
  const now = input.now ?? new Date();

  if (!config.enabled) {
    return {
      type: "no_notification",
      reason: "notificationDecisionConfig.enabled=false（通知条件はまだ人間の承認前です）",
    };
  }

  if (input.dataCompleteness === "unavailable") {
    return { type: "insufficient_data", reason: "静的ハザード情報・予測総雨量のいずれも確認できませんでした" };
  }
  if (input.staticFloodHazard.status === "unknown") {
    return { type: "insufficient_data", reason: "静的な洪水ハザード情報を確認できませんでした" };
  }
  if (
    input.totalPredictedRainfall.status === "unavailable" ||
    input.totalPredictedRainfall.totalPredictedRainfallMm === null
  ) {
    return { type: "insufficient_data", reason: "予測総雨量を確認できませんでした" };
  }

  const cooldown = checkCooldown(input.previousNotificationState, config, now);
  if (cooldown) return cooldown;

  const hazardMatches = input.staticFloodHazard.depthRank >= config.hazardDepthRankThreshold;
  const rainfallMatches = input.totalPredictedRainfall.totalPredictedRainfallMm >= config.totalRainfallThresholdMm;

  if (hazardMatches && rainfallMatches) {
    return {
      type: "candidate",
      reason:
        `静的洪水ハザード(depthRank=${input.staticFloodHazard.depthRank}) かつ ` +
        `今後${input.totalPredictedRainfall.windowHours}時間の予測総雨量` +
        `(${input.totalPredictedRainfall.totalPredictedRainfallMm}mm)が現在の候補条件を満たしました`,
      decisionVersion: config.decisionVersion,
    };
  }

  return { type: "no_notification", reason: "現在の候補条件を満たしませんでした" };
}
