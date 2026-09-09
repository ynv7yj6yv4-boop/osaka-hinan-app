// 試作3 次段階 PART 1・要件定義書3「方式A」: Firebase Scheduled Functionsによる
// 監視地点の定期確認。
//
// 【重要・現時点のスコープ】この関数はまだ「実際の通知送信」までは行わない。
// 確認できているのは以下の配管:
//   Cloud Scheduler → onSchedule実行 → Firestore読み取り
//                   → 実際のstaticFloodHazard・rainfallForecast取得(方式A)
//                   → 評価関数呼び出し → Firestore書き込み（確認記録のみ）
//
// 【方式Aで解決したこと】
// 以前はlib/tilePixel.tsがブラウザのCanvas/Image APIに依存しており、Node.js
// 環境（Cloud Functions）で動作しなかったため、常に「確認できなかった」という
// ダミー入力を評価関数へ渡していた。tilePixelNode.ts（pngjsによるNode.js版
// PNGデコード）を実装したことで、実際のハザードタイル・降雨予測タイルを
// サーバー側で取得できるようになった。
//
// 【まだ実装していないこと・重要】
// - 実際の通知送信(FCM送信)コード自体はまだ書いていない。evaluateNotificationDecision()
//   が"candidate"を返しても、それを実際にFCMへ送る処理は別途必要。
// - notificationDecisionConfig.enabled は false のままなので、万一この後の
//   実装に誤りがあっても、実際の送信につながる"candidate"には到達しない
//   （多重防御。詳細はnotificationDecisionConfig.ts参照）。

import { onSchedule } from "firebase-functions/scheduler";
import { setGlobalOptions } from "firebase-functions/v2";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { evaluateNotificationDecision, type DataCompleteness } from "./notificationDecision";
import { notificationDecisionConfig } from "./notificationDecisionConfig";
import { classifyHazardPixelNode, type HazardPixelStatus } from "./hazardPixelClassifierNode";
import { fetchRainfallForecastNode } from "./rainfallForecastNode";

initializeApp();
setGlobalOptions({ region: "asia-northeast1" });

// components/hazardLayers.ts の HAZARD_TILE_URL.flood と同じ値（意図的に複製。
// notificationDecisionConfig.targetHazard="flood"のみが対象のため、floodだけ持つ）。
const FLOOD_HAZARD_TILE_URL = "https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png";

function toStaticFloodHazardInput(pixel: HazardPixelStatus) {
  if (pixel.status === "hazard") return { status: "evaluated" as const, depthRank: pixel.rank };
  if (pixel.status === "outside") return { status: "evaluated" as const, depthRank: 0 as const };
  return { status: "unknown" as const, depthRank: 0 as const };
}

// 【監視頻度について(要件定義書2 次段階 PART 1-2)】
// 5分・10分のどちらを本番採用するかはまだ決定していない。ここでは
// 「高解像度降水ナウキャスト(実況・予測)の更新間隔が5分」という事実に
// 合わせ、技術検証用に5分ごとに設定している。これは技術検証用の値であり、
// 最終的な監視頻度の決定ではない。
export const checkMonitoringPoints = onSchedule(
  {
    schedule: "every 5 minutes",
    timeoutSeconds: 60,
    retryCount: 0, // 5分後に次の実行が来るため、失敗時の自動リトライは行わない
  },
  async () => {
    const db = getFirestore();
    const snapshot = await db
      .collection("monitoringPoints")
      .where("notificationEnabled", "==", true)
      .get();

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

    console.log(
      `[checkMonitoringPoints] checked=${snapshot.size} candidateCount=${candidateCount} insufficientDataCount=${insufficientDataCount} ` +
        `enabled=${notificationDecisionConfig.enabled} decisionVersion=${notificationDecisionConfig.decisionVersion}`
    );
  }
);
