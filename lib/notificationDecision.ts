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

  // 重複通知防止（cooldown）
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
