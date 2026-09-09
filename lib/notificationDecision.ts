// 試作3 PART 3（要件定義書2 PART 10）: 通知判定の独立モジュール。
//
// 【重要】現在地の危険度判定(lib/riskAssessment.ts のRiskLevel)とは
// 完全に別ロジックである。RiskLevelの算出方法・値をここから参照したり、
// ここでの判定結果をRiskLevelへ書き戻したりしない。
//
// このファイルは以下を受け取り、通知判定結果を返す純粋関数のみを提供する
// （ネットワーク・Firestore・FCM等のI/Oは一切行わない。呼び出し側の責務）。
// - staticFloodHazard: 既存のhazard/outside/unknown・depthRankをそのまま使う
// - rainfallForecast: lib/rainfallForecast.ts の結果（実況とは別）
// - dataCompleteness: 上記2つを総合してどれだけ判定できたか
// - previousNotificationState: 重複通知防止のための前回状態

import { notificationDecisionConfig, type NotificationDecisionConfig } from "./notificationDecisionConfig.ts";

export type StaticFloodHazardInput = {
  /** lib/hazardPixelClassifier.ts の HazardPixelStatus.status と同じ考え方 */
  status: "evaluated" | "unknown";
  /** lib/hazardColorLegend.ts の DepthRank(0〜5)。status="unknown"の場合は無視する。 */
  depthRank: 0 | 1 | 2 | 3 | 4 | 5;
};

export type RainfallForecastInput = {
  status: "forecast" | "unavailable";
  /** lib/rainfallColorLegend.ts の rank(1〜8)。判別不能ならnull。 */
  rank: number | null;
  leadTimeMinutes: number | null;
};

// 要件定義書3: 「これから降り続けると予測される総雨量」ベースの判定用入力。
// lib/floodRiskForecast.ts（Open-Meteo/JMA MSM、mm単位）の結果をそのまま渡す。
export type TotalPredictedRainfallInput = {
  status: "evaluated" | "unavailable";
  totalPredictedRainfallMm: number | null;
  windowHours: number | null;
};

export type DataCompleteness = "complete" | "partial" | "unavailable";

export type PreviousNotificationState = {
  lastNotificationState: "sent" | "not_sent" | null;
  /** 前回の実際の通知送信時刻(ISO文字列)。まだ一度も送っていなければnull。 */
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

/** evaluateNotificationDecision/evaluateFloodRiskNotificationDecisionで共通のcooldownチェック。 */
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
 *
 * 【重要】「大雨が予測されたので通知する」のではなく、「これから降り続けると
 * 予測される総雨量が、静的ハザード想定区域内で道路の冠水を引き起こしうる
 * 規模かどうか」を判断してから通知する。evaluateNotificationDecision()
 * （その瞬間の降雨の強さ=rankを使う旧来の判定）とは別の判定として共存させる
 * （どちらを本番採用するかは人間側が決定する。要件定義書3参照）。
 *
 * 【重要な限界】totalPredictedRainfallMmが閾値を超えることは、あくまで
 * 研究上の代理指標(proxy)であり、「実際にその地点の道路が冠水すること」を
 * 検証済みの物理モデル・実測データに基づいて判定するものではない
 * （lib/floodRiskForecast.ts冒頭のコメント参照）。
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

  // 【最優先・多重防御】evaluateNotificationDecision()と同じマスタースイッチ。
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
