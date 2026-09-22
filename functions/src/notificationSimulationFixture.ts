// 要件定義書4後続: 開発者限定の自動通知パイプライン検証専用のfixture入力。
//
// 【重要】本番の気象データ取得コード(classifyHazardPixelNode・
// fetchTotalPredictedRainfall等)はここでは一切呼ばない。実データを書き換えたり
// notificationDecisionConfigの閾値を下げたりする代わりに、判定関数へ渡す入力
// そのものを固定値にする。現在の本番閾値(hazardDepthRankThreshold=1・
// totalRainfallThresholdMm=100)に対して、確実にcandidateとなるよう余裕を
// 持たせた値にしてある。閾値そのものはnotificationDecisionConfigの値を
// そのまま使う(devSimulationCheck.ts参照。ここでは閾値の複製・変更をしない)。

import type {
  StaticFloodHazardInput,
  TotalPredictedRainfallInput,
  DataCompleteness,
  PreviousNotificationState,
} from "./notificationDecision";
import type { HazardPixelStatus } from "./hazardPixelClassifierNode";

export const SIMULATION_FIXTURE = {
  // notificationLogsのstaticFloodHazardStatus記録用(HazardPixelStatus["status"]と
  // 同じ語彙。実際にはclassifyHazardPixelNode()の生の分類結果に相当する値)。
  hazardPixelStatus: "hazard" as HazardPixelStatus["status"],
  staticFloodHazard: { status: "evaluated", depthRank: 2 } as StaticFloodHazardInput,
  totalPredictedRainfall: {
    status: "evaluated",
    totalPredictedRainfallMm: 150,
    windowHours: 24,
  } as TotalPredictedRainfallInput,
  dataCompleteness: "complete" as DataCompleteness,
  // cooldownに絶対ブロックされないよう、前回通知なしとして固定する
  // (1回の検証で確実にcandidateへ到達させるため)。
  previousNotificationState: { lastNotificationState: null, lastNotifiedAt: null } as PreviousNotificationState,
};
