// 要件定義書4後続: 開発者本人だけを対象とした自動通知パイプラインの限定検証。
//
// 【重要・本番経路との関係】このファイルは monitoringCheck.ts の通常ループを
// 一切変更しない、完全に独立したテスト専用の経路である。
// - 本番の notificationDecisionConfig.enabled(シングルトン)は一度も
//   書き換えない。evaluateFloodRiskNotificationDecision()・
//   processCandidateSend()へは、呼び出し時の引数としてのみ
//   ローカルなenabled:trueを渡す(両関数がもともとconfig/configEnabledを
//   呼び出し側から受け取れる設計になっているため、これが可能)。
// - monitoringPointsを検索(where句)することは一切なく、許可された1件の
//   ドキュメントIDだけをdoc().get()で直接取得する。他の地点へは技術的に
//   到達できない構造。
// - 実際の気象データ取得(classifyHazardPixelNode等)は行わない。
//   notificationSimulationFixture.tsの固定入力のみを使う。
//
// 【多重防御】targetMonitoringPointIdとallowlistedMonitoringPointIdが完全一致
// しない限り、Firestoreへの参照すら作らずに即座にブロックする。

import type { Firestore } from "firebase-admin/firestore";
import { evaluateFloodRiskNotificationDecision } from "./notificationDecision";
import { notificationDecisionConfig } from "./notificationDecisionConfig";
import { processCandidateSend } from "./notificationSendPipeline";
import { sendFcmNotification } from "./fcmSender";
import { notificationMessageSimulationDraft } from "./notificationMessage";
import { resolveGitCommitHash, type NotificationLogDoc } from "./notificationLog";
import { SIMULATION_FIXTURE } from "./notificationSimulationFixture";

export type DevSimulationResult =
  | { status: "blocked_id_mismatch" }
  | { status: "not_found" }
  | {
      status: "completed";
      decisionType: string;
      sendAttempted: boolean;
      sendResult: "success" | "failed" | null;
      sendErrorCode: string | null;
      autoDisabledPoint: boolean;
    };

export type DevSimulationDeps = {
  now?: Date;
  gitCommitHash?: string | null;
  sendFcmNotification?: typeof sendFcmNotification;
};

export async function runDeveloperNotificationSimulation(
  db: Firestore,
  targetMonitoringPointId: string,
  allowlistedMonitoringPointId: string,
  deps: DevSimulationDeps = {}
): Promise<DevSimulationResult> {
  // 【最重要・多重防御】ここを通過しない限り、Firestoreへのアクセス自体を
  // 一切行わない(一般ユーザーの地点へ到達する経路が存在しない)。
  if (!allowlistedMonitoringPointId || targetMonitoringPointId !== allowlistedMonitoringPointId) {
    return { status: "blocked_id_mismatch" };
  }

  const now = deps.now ?? new Date();
  const gitCommitHash = deps.gitCommitHash ?? resolveGitCommitHash();
  const sendFn = deps.sendFcmNotification ?? sendFcmNotification;

  const docRef = db.collection("monitoringPoints").doc(targetMonitoringPointId);
  const snap = await docRef.get();
  if (!snap.exists) return { status: "not_found" };

  const data = snap.data() as { fcmToken?: string };
  const fcmToken = data.fcmToken ?? "";

  // 【重要】本番のnotificationDecisionConfig(シングルトン)は書き換えない。
  // ここではローカル変数として、閾値はそのまま・enabledだけtrueにした
  // コピーを判定関数への引数として渡すだけ。
  const simulationConfig = { ...notificationDecisionConfig, enabled: true };

  const decision = evaluateFloodRiskNotificationDecision({
    staticFloodHazard: SIMULATION_FIXTURE.staticFloodHazard,
    totalPredictedRainfall: SIMULATION_FIXTURE.totalPredictedRainfall,
    dataCompleteness: SIMULATION_FIXTURE.dataCompleteness,
    previousNotificationState: SIMULATION_FIXTURE.previousNotificationState,
    now,
    config: simulationConfig,
  });

  // configEnabledも同様にローカルなtrueを直接渡す(processCandidateSend自体は
  // notificationDecisionConfigを一切importしていない)。
  const sendOutcome = await processCandidateSend(
    decision,
    true,
    fcmToken,
    now,
    sendFn,
    notificationMessageSimulationDraft
  );

  const logDoc: NotificationLogDoc = {
    monitoringPointId: targetMonitoringPointId,
    evaluatedAt: now.toISOString(),
    decisionVersion: notificationDecisionConfig.decisionVersion,
    gitCommitHash,
    staticFloodHazardStatus: SIMULATION_FIXTURE.hazardPixelStatus,
    staticFloodHazardDepthRank: SIMULATION_FIXTURE.staticFloodHazard.depthRank,
    totalPredictedRainfallMm: SIMULATION_FIXTURE.totalPredictedRainfall.totalPredictedRainfallMm,
    windowHours: SIMULATION_FIXTURE.totalPredictedRainfall.windowHours,
    dataCompleteness: SIMULATION_FIXTURE.dataCompleteness,
    decisionType: decision.type,
    decisionReason: decision.reason,
    sendAttempted: sendOutcome.sendAttempted,
    sendResult: sendOutcome.sendResult,
    sendErrorCode: sendOutcome.sendErrorCode,
    autoDisabledPoint: sendOutcome.autoDisabledPoint,
    executionMode: "simulation",
  };

  // 要件定義書4 §10と同じ考え方: notificationLogsの追加と、対象1件の
  // cooldown/notificationEnabled更新を同じbatchに含め、同一commitで
  // 成功/失敗させる。
  const batch = db.batch();
  batch.set(db.collection("notificationLogs").doc(), logDoc);

  const pointUpdate: Record<string, unknown> = {};
  if (sendOutcome.cooldownUpdate) Object.assign(pointUpdate, sendOutcome.cooldownUpdate);
  if (sendOutcome.notificationEnabledUpdate === false) pointUpdate.notificationEnabled = false;
  if (Object.keys(pointUpdate).length > 0) batch.update(docRef, pointUpdate);

  await batch.commit();

  return {
    status: "completed",
    decisionType: decision.type,
    sendAttempted: sendOutcome.sendAttempted,
    sendResult: sendOutcome.sendResult,
    sendErrorCode: sendOutcome.sendErrorCode,
    autoDisabledPoint: sendOutcome.autoDisabledPoint,
  };
}
