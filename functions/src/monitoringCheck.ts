// 要件定義書3: checkMonitoringPointsの中核ロジックを、起動方法(Cloud Functions
// のonSchedule / GitHub Actionsからの単体実行)に依存しない形で切り出したもの。
//
// 【重要・このアプリの中心的な設計思想】
// 「大雨が予測されたので通知する」のではなく、「これから降り続けると
// 予測される総雨量が、静的ハザード想定区域内で道路の冠水を引き起こしうる
// 規模かどうか」を判断してから通知する。そのため、ここでの主判定は
// evaluateFloodRiskNotificationDecision()（Open-Meteo/JMA MSMの予測総雨量
// ベース）を使う。以前からあるevaluateNotificationDecision()（その瞬間の
// 気象庁ナウキャスト予測rankベース、60分先まで）も、比較・研究目的で
// 引き続き並行評価し、両方の結果をFirestoreへ記録する
// （どちらのみを本番採用するかは人間側が確定する）。

import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import {
  evaluateNotificationDecision,
  evaluateFloodRiskNotificationDecision,
  type DataCompleteness,
} from "./notificationDecision";
import { notificationDecisionConfig } from "./notificationDecisionConfig";
import { classifyHazardPixelNode, type HazardPixelStatus } from "./hazardPixelClassifierNode";
import { fetchRainfallForecastNode } from "./rainfallForecastNode";
import { fetchTotalPredictedRainfall } from "./floodRiskForecastNode";
import { sendFcmNotification } from "./fcmSender";
import { processCandidateSend } from "./notificationSendPipeline";
import { notificationMessageDraft } from "./notificationMessage";
import { resolveGitCommitHash, shouldWriteNotificationLog, type NotificationLogDoc } from "./notificationLog";

// components/hazardLayers.ts の HAZARD_TILE_URL.flood と同じ値（意図的に複製。
// notificationDecisionConfig.targetHazard="flood"のみが対象のため、floodだけ持つ）。
const FLOOD_HAZARD_TILE_URL = "https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png";

function toStaticFloodHazardInput(pixel: HazardPixelStatus) {
  if (pixel.status === "hazard") return { status: "evaluated" as const, depthRank: pixel.rank };
  if (pixel.status === "outside") return { status: "evaluated" as const, depthRank: 0 as const };
  return { status: "unknown" as const, depthRank: 0 as const };
}

export type MonitoringCheckResult = {
  checked: number;
  candidateCount: number;
  insufficientDataCount: number;
};

// 要件定義書4 §2: 送信可否判定と送信処理をmonitoringCheck.tsのループから
// 注入可能にする(依存性注入・テスト容易性の確保)。本番の呼び出し元
// (index.ts / runStandalone.ts)はdepsを渡さず、デフォルト(実際のFCM送信・
// 現在時刻・GITHUB_SHA)がそのまま使われる。
export type MonitoringCheckDeps = {
  now?: Date;
  gitCommitHash?: string | null;
  sendFcmNotification?: typeof sendFcmNotification;
};

export async function runMonitoringCheck(db: Firestore, deps: MonitoringCheckDeps = {}): Promise<MonitoringCheckResult> {
  const snapshot = await db.collection("monitoringPoints").where("notificationEnabled", "==", true).get();

  const now = deps.now ?? new Date();
  const gitCommitHash = deps.gitCommitHash ?? resolveGitCommitHash();
  const sendFn = deps.sendFcmNotification ?? sendFcmNotification;
  let candidateCount = 0;
  let insufficientDataCount = 0;

  // Firestoreの一括更新はバッチ1件あたり最大500件までのため、
  // 件数が少ない研究プロトタイプの現段階ではbatchで十分。
  // 【要件定義書4 §10】monitoringPointsの更新とnotificationLogsの追加を
  // 同じbatchに含めることで、両者が同じcommitで成功/失敗するようにし
  // (「送信成功なのにcooldown更新だけ失敗」「ログだけ書き込まれない」
  // 等の不整合を、新規のトランザクション機構を導入せずに避ける)。
  const batch = db.batch();

  for (const doc of snapshot.docs) {
    const data = doc.data() as {
      latitude?: number;
      longitude?: number;
      lastNotificationState?: "sent" | "not_sent" | null;
      lastNotifiedAt?: string | null;
      lastDecisionType?: string | null;
      fcmToken?: string;
    };

    if (typeof data.latitude !== "number" || typeof data.longitude !== "number") {
      // 座標が無い(不正な)地点は評価せず、その旨だけ記録する(黙って無視しない)。
      batch.update(doc.ref, { lastCheckedAt: FieldValue.serverTimestamp(), lastDecisionType: "error" });
      insufficientDataCount++;
      continue;
    }
    const { latitude, longitude } = data;
    const previousNotificationState = {
      lastNotificationState: data.lastNotificationState ?? null,
      lastNotifiedAt: data.lastNotifiedAt ?? null,
    };

    // 方式A: 実際のstaticFloodHazard・ナウキャスト予測rank・予測総雨量を並行取得する。
    const [hazardPixel, rainfallForecast, totalPredictedRainfall] = await Promise.all([
      classifyHazardPixelNode(FLOOD_HAZARD_TILE_URL, latitude, longitude),
      fetchRainfallForecastNode(latitude, longitude, notificationDecisionConfig.forecastHorizonMinutes),
      fetchTotalPredictedRainfall(latitude, longitude, notificationDecisionConfig.totalRainfallWindowHours),
    ]);

    const staticFloodHazard = toStaticFloodHazardInput(hazardPixel);

    // --- 主判定: 予測総雨量ベース(このアプリの中心的な設計思想) ---
    const totalPredictedRainfallInput =
      totalPredictedRainfall.status === "evaluated"
        ? {
            status: "evaluated" as const,
            totalPredictedRainfallMm: totalPredictedRainfall.totalPredictedRainfallMm,
            windowHours: totalPredictedRainfall.windowHours,
          }
        : { status: "unavailable" as const, totalPredictedRainfallMm: null, windowHours: null };

    const floodRiskOk = staticFloodHazard.status === "evaluated";
    const totalRainfallOk = totalPredictedRainfallInput.status === "evaluated";
    const floodRiskDataCompleteness: DataCompleteness =
      floodRiskOk && totalRainfallOk ? "complete" : floodRiskOk || totalRainfallOk ? "partial" : "unavailable";

    const floodRiskDecision = evaluateFloodRiskNotificationDecision({
      staticFloodHazard,
      totalPredictedRainfall: totalPredictedRainfallInput,
      dataCompleteness: floodRiskDataCompleteness,
      previousNotificationState,
      now,
    });

    // --- 比較用: 従来のナウキャストrankベース判定(研究目的で並行記録) ---
    const rainfallForecastInput =
      rainfallForecast.status === "forecast"
        ? { status: "forecast" as const, rank: rainfallForecast.rank, leadTimeMinutes: rainfallForecast.leadTimeMinutes }
        : { status: "unavailable" as const, rank: null, leadTimeMinutes: null };
    const rankRainfallOk = rainfallForecastInput.status === "forecast";
    const rankDataCompleteness: DataCompleteness =
      floodRiskOk && rankRainfallOk ? "complete" : floodRiskOk || rankRainfallOk ? "partial" : "unavailable";
    const legacyDecision = evaluateNotificationDecision({
      staticFloodHazard,
      rainfallForecast: rainfallForecastInput,
      dataCompleteness: rankDataCompleteness,
      previousNotificationState,
      now,
    });

    if (floodRiskDecision.type === "candidate") candidateCount++; // enabled:falseの間は理論上到達しない
    if (floodRiskDecision.type === "insufficient_data") insufficientDataCount++;

    // 要件定義書4 §2・§5.5・§8: 送信可否判定(floodRiskDecision)と送信処理を
    // 分離実装する。ここでもnotificationDecisionConfig.enabledを確認してから
    // でなければ送信関数(sendFn)を呼ばない(判定ロジック側の多重防御と
    // 二重に保護する。enabled=falseの間はsendFnが一度も呼ばれない)。
    const sendOutcome = await processCandidateSend(
      floodRiskDecision,
      notificationDecisionConfig.enabled,
      data.fcmToken ?? "",
      now,
      sendFn,
      notificationMessageDraft
    );

    // 要件定義書4 §5.7: 既存のlastDecisionType(前回評価の結果)をそのまま
    // 状態遷移検知に使う(新規の状態管理を増やさない)。
    const previousDecisionType = data.lastDecisionType ?? null;
    if (shouldWriteNotificationLog(previousDecisionType, floodRiskDecision.type, sendOutcome.sendAttempted)) {
      const logDoc: NotificationLogDoc = {
        monitoringPointId: doc.id,
        evaluatedAt: now.toISOString(),
        decisionVersion: notificationDecisionConfig.decisionVersion,
        gitCommitHash,
        staticFloodHazardStatus: hazardPixel.status,
        staticFloodHazardDepthRank: staticFloodHazard.depthRank,
        totalPredictedRainfallMm: totalPredictedRainfallInput.totalPredictedRainfallMm,
        windowHours: totalPredictedRainfallInput.windowHours,
        dataCompleteness: floodRiskDataCompleteness,
        decisionType: floodRiskDecision.type,
        decisionReason: floodRiskDecision.reason,
        sendAttempted: sendOutcome.sendAttempted,
        sendResult: sendOutcome.sendResult,
        sendErrorCode: sendOutcome.sendErrorCode,
        autoDisabledPoint: sendOutcome.autoDisabledPoint,
        executionMode: "normal",
      };
      // notificationLogsは横断集計・研究分析のしやすさを優先し、トップレベル
      // コレクションとする(monitoringPoints/{id}/logsのサブコレクションにしない)。
      batch.set(db.collection("notificationLogs").doc(), logDoc);
    }

    // 取得した実データは、後日の検証・研究のため記録として残す(黙って捨てない)。
    // 【要件定義書4 §10】monitoringPointsの更新とnotificationLogsの追加
    // (上記batch.set)は同じbatchに含まれるため、同一commitで成功/失敗する。
    batch.update(doc.ref, {
      lastCheckedAt: FieldValue.serverTimestamp(),
      decisionVersion: notificationDecisionConfig.decisionVersion,
      lastDecisionType: floodRiskDecision.type,
      lastStaticFloodHazardStatus: hazardPixel.status,
      lastStaticFloodHazardDepthRank: staticFloodHazard.depthRank,
      lastTotalPredictedRainfallStatus: totalPredictedRainfallInput.status,
      lastTotalPredictedRainfallMm: totalPredictedRainfallInput.totalPredictedRainfallMm,
      lastTotalPredictedRainfallWindowHours: totalPredictedRainfallInput.windowHours,
      // 要件定義書4 §5.6: 送信が実際に成功した場合にのみ更新する(cooldown用)。
      // 送信を試みなかった場合・試みて失敗した場合はここでスプレッドされず、
      // 既存のフィールド値は変更されない。
      ...(sendOutcome.cooldownUpdate ?? {}),
      // 要件定義書4 §5.8: 恒久的に無効なトークンを検出した場合のみfalseにする。
      ...(sendOutcome.notificationEnabledUpdate === false ? { notificationEnabled: false } : {}),
      // 比較用(研究目的)。本番採用の判定はlastDecisionType(予測総雨量ベース)。
      lastLegacyRankDecisionType: legacyDecision.type,
      lastRainfallForecastStatus: rainfallForecastInput.status,
      lastRainfallForecastRank: rainfallForecastInput.rank,
      lastEvaluatedForecastTime: rainfallForecast.status === "forecast" ? rainfallForecast.forecastValidTime : null,
    });
  }

  if (snapshot.size > 0) await batch.commit();

  return { checked: snapshot.size, candidateCount, insufficientDataCount };
}
