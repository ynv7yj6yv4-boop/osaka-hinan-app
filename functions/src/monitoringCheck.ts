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

export async function runMonitoringCheck(db: Firestore): Promise<MonitoringCheckResult> {
  const snapshot = await db.collection("monitoringPoints").where("notificationEnabled", "==", true).get();

  const now = new Date();
  let candidateCount = 0;
  let insufficientDataCount = 0;

  // Firestoreの一括更新はバッチ1件あたり最大500件までのため、
  // 件数が少ない研究プロトタイプの現段階ではbatchで十分。
  const batch = db.batch();

  for (const doc of snapshot.docs) {
    const data = doc.data() as {
      latitude?: number;
      longitude?: number;
      lastNotificationState?: "sent" | "not_sent" | null;
      lastNotifiedAt?: string | null;
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

    // 実際の通知送信(FCM)は行わない。確認した事実とバージョンのみ記録する。
    // 取得した実データも、後日の検証・研究のため記録として残す(黙って捨てない)。
    batch.update(doc.ref, {
      lastCheckedAt: FieldValue.serverTimestamp(),
      decisionVersion: notificationDecisionConfig.decisionVersion,
      lastDecisionType: floodRiskDecision.type,
      lastStaticFloodHazardStatus: hazardPixel.status,
      lastStaticFloodHazardDepthRank: staticFloodHazard.depthRank,
      lastTotalPredictedRainfallStatus: totalPredictedRainfallInput.status,
      lastTotalPredictedRainfallMm: totalPredictedRainfallInput.totalPredictedRainfallMm,
      lastTotalPredictedRainfallWindowHours: totalPredictedRainfallInput.windowHours,
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
