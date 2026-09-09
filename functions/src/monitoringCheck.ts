// 要件定義書3: checkMonitoringPointsの中核ロジックを、起動方法(Cloud Functions
// のonSchedule / GitHub Actionsからの単体実行)に依存しない形で切り出したもの。
//
// 【重要】判定ロジック自体は一切変更していない。以前はfunctions/src/index.ts
// (onScheduleハンドラ)の中に直接書かれていたコードを、そのままここへ移した
// だけである(Cloud Functions版・スタンドアロン版の両方から呼べるようにする
// ための切り出し)。

import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { evaluateNotificationDecision, type DataCompleteness } from "./notificationDecision";
import { notificationDecisionConfig } from "./notificationDecisionConfig";
import { classifyHazardPixelNode, type HazardPixelStatus } from "./hazardPixelClassifierNode";
import { fetchRainfallForecastNode } from "./rainfallForecastNode";

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

    // 方式A: 実際のstaticFloodHazard・rainfallForecastを並行取得する。
    const [hazardPixel, rainfallForecast] = await Promise.all([
      classifyHazardPixelNode(FLOOD_HAZARD_TILE_URL, latitude, longitude),
      fetchRainfallForecastNode(latitude, longitude, notificationDecisionConfig.forecastHorizonMinutes),
    ]);

    const staticFloodHazard = toStaticFloodHazardInput(hazardPixel);
    const rainfallForecastInput =
      rainfallForecast.status === "forecast"
        ? { status: "forecast" as const, rank: rainfallForecast.rank, leadTimeMinutes: rainfallForecast.leadTimeMinutes }
        : { status: "unavailable" as const, rank: null, leadTimeMinutes: null };

    const hazardOk = staticFloodHazard.status === "evaluated";
    const rainfallOk = rainfallForecastInput.status === "forecast";
    const dataCompleteness: DataCompleteness =
      hazardOk && rainfallOk ? "complete" : hazardOk || rainfallOk ? "partial" : "unavailable";

    const decision = evaluateNotificationDecision({
      staticFloodHazard,
      rainfallForecast: rainfallForecastInput,
      dataCompleteness,
      previousNotificationState: {
        lastNotificationState: data.lastNotificationState ?? null,
        lastNotifiedAt: data.lastNotifiedAt ?? null,
      },
      now,
    });

    if (decision.type === "candidate") candidateCount++; // enabled:falseの間は理論上到達しない
    if (decision.type === "insufficient_data") insufficientDataCount++;

    // 実際の通知送信(FCM)は行わない。確認した事実とバージョンのみ記録する。
    // 取得した実データも、後日の検証・研究のため記録として残す(黙って捨てない)。
    batch.update(doc.ref, {
      lastCheckedAt: FieldValue.serverTimestamp(),
      decisionVersion: notificationDecisionConfig.decisionVersion,
      lastDecisionType: decision.type,
      lastStaticFloodHazardStatus: hazardPixel.status,
      lastStaticFloodHazardDepthRank: staticFloodHazard.depthRank,
      lastRainfallForecastStatus: rainfallForecastInput.status,
      lastRainfallForecastRank: rainfallForecastInput.rank,
      lastEvaluatedForecastTime: rainfallForecast.status === "forecast" ? rainfallForecast.forecastValidTime : null,
    });
  }

  if (snapshot.size > 0) await batch.commit();

  return { checked: snapshot.size, candidateCount, insufficientDataCount };
}
