// 要件定義書4 §5.7・§7: notificationLogs(新規トップレベルコレクション)の
// ドキュメント型と、記録要否・gitCommitHashの解決という2つの純粋関数。
// Firestoreへの実際の書き込みはmonitoringCheck.ts側の責務(このファイルは
// I/Oを一切行わない。テスト容易性のため)。

import type { HazardPixelStatus } from "./hazardPixelClassifierNode";
import type { DataCompleteness, NotificationDecisionResult } from "./notificationDecision";

export type NotificationLogDoc = {
  monitoringPointId: string;
  evaluatedAt: string;
  decisionVersion: string;
  gitCommitHash: string | null;
  staticFloodHazardStatus: HazardPixelStatus["status"];
  staticFloodHazardDepthRank: 0 | 1 | 2 | 3 | 4 | 5;
  totalPredictedRainfallMm: number | null;
  windowHours: number | null;
  dataCompleteness: DataCompleteness;
  decisionType: NotificationDecisionResult["type"];
  decisionReason: string;
  sendAttempted: boolean;
  sendResult: "success" | "failed" | null;
  sendErrorCode: string | null;
  autoDisabledPoint: boolean;
};

/**
 * 要件定義書4 §7: GitHub ActionsからはGITHUB_SHAが渡される。ローカル実行等で
 * 値が存在しない場合でも処理が壊れないよう、既存の型設計(string | null)に
 * 合わせてnullを返す。
 */
export function resolveGitCommitHash(env: NodeJS.ProcessEnv = process.env): string | null {
  const sha = env.GITHUB_SHA;
  return typeof sha === "string" && sha.length > 0 ? sha : null;
}

/**
 * 要件定義書4 §5.7: 5分間隔で無条件に全評価を保存すると増大しすぎるため、
 * 以下のいずれかの場合のみログを作成する。
 * - 前回評価からdecisionTypeが変化した(previousDecisionTypeがnull=初回評価も含む。
 *   既存のhasForecastChanged()と同じ「変化した時だけ記録する」考え方)
 * - 実際に送信を試みた(成功・失敗を問わない。恒久的無効トークンによる
 *   自動off化は送信試行を伴って初めて発生するため、autoDisabledPointの場合も
 *   このsendAttemptedで自動的にカバーされる)
 * 変化なし・送信も試みていない場合は重複記録しない。
 */
export function shouldWriteNotificationLog(
  previousDecisionType: string | null,
  decisionType: string,
  sendAttempted: boolean
): boolean {
  return previousDecisionType !== decisionType || sendAttempted;
}
