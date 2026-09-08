// 試作3 通知判定ロジックの実験実装 PART16〜19: 過去データによるNotification Backtest。
//
// 【重要・このスクリプトの位置づけ】
// これは「最終的な採用閾値・採用方式を決めるための本実験」ではなく、
// 4つの通知判定方式(Method1〜4)を過去データで比較できる仕組みが正しく
// 動くかを確認する「技術確認」である(要件定義書2 PART18の指示どおり)。
//
// 【重要な簡略化・限界（正直に明記する）】
// 1. staticFloodHazardの判定には本来lib/hazardPixelClassifier.tsが必要だが、
//    これはブラウザのCanvas APIに依存しており、このNode.jsスクリプトからは
//    呼び出せない(data/README.md「Firebase Scheduled Functionsの技術的
//    制約」と同じ理由)。そのため、このスクリプトでは各地点のhazard状態を
//    「あらかじめ人間が仮定した値」として直接指定している。実際のタイル
//    判定結果ではない。
// 2. Open-Meteoの historical-forecast-api は「各モデル更新の最初の数時間を
//    継ぎ合わせた連続時系列」であり、3時間おきの個別モデルrunをそのまま
//    独立に取得するものではない(公式ドキュメントで確認)。そのため、
//    このスクリプトの「forecast run間継続性」の検証は、連続時系列を
//    一定間隔でスライドさせた近似であり、真に独立したrunアーカイブを
//    使った検証ではない。
// 3. 本実験地点はまだ人間が固定していない(PART17)。以下の地点は
//    「コードが正しく動くことを確認するための仮の地点」であり、
//    本実験用に選定されたものではない。
//
// 【要件定義書3 §14・PART L追記・technical verification only】
// このスクリプトはHistorical Forecast APIを使った初期の技術確認であり、
// 履歴として残している。要件定義書3 §53・54で、Historical Forecast APIの用途は
// 「Rain Event Dataset」(雨天日・IETD・降雨イベント抽出)に整理され、
// forecast run再現・Notification Backtestの役割はSingle Runs APIへ移した。
// 固定JSON(scripts/research-data/static-flood-hazard-points.json)を使い、
// Single Runs APIと接続した現在の一気通貫パイプラインは
// notification-backtest-static-hazard.mjs を参照。このファイルの
// assumedHazard(仮定hazard)は、上記の役割整理より前の技術確認結果として
// そのまま残しており、本実験の入力としては使用しない。
//
// 実行方法: node scripts/research-data/notification-backtest.mjs

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { fetchHistoricalHourlyPrecipitation } from "../../lib/rainfallForecastOpenMeteo.ts";
import {
  hashForecastContent,
  initialNotificationPointState,
  evaluateMethod,
  ALL_METHOD_IDS,
} from "../../lib/notificationExperiment.ts";
import { splitIntoRainfallEvents, computeExperimentMetrics } from "../../lib/notificationExperimentMetrics.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 【重要】以下はhazard状態を仮定した技術確認用地点。本実験地点ではない。
const TEST_POINTS = [
  { id: "point-hazard-assumed", label: "洪水ハザード区域内と仮定", lat: 34.68, lng: 135.5, assumedHazard: "hazard" },
  { id: "point-outside-assumed", label: "洪水ハザード区域外と仮定", lat: 34.75, lng: 135.42, assumedHazard: "outside" },
];

// 実験パラメータ(PART7)。最終採用値ではない。
const EXPERIMENT_CONFIG = {
  configId: "backtest-technical-check-v1",
  hourlyRainfallThresholdMm: 10,
  accumulated3hThresholdMm: 20,
  accumulated6hThresholdMm: 30,
  requiredConsecutiveForecastHours: 2,
  requiredConsecutiveRuns: 2,
};

// PART15: IETD(無降雨とみなす時間)。学術的に確立した単一の値はないため、
// ここでは6時間を技術確認用の仮値として使う(最終値ではない)。
const IETD_HOURS = 6;
// 「弱い雨」とみなすイベントのピーク雨量しきい値(技術確認用の仮値)。
const WEAK_RAIN_PEAK_THRESHOLD_MM = 5;

// バックテスト対象期間(技術確認のため直近1週間程度で十分。PART18)。
function getDateRange() {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

/** 連続時系列から、checkIndex時点を起点とした6時間分の「その時点で分かった予報」を切り出す近似。 */
function windowAt(hourly, checkIndex, hoursAhead = 6) {
  return hourly.slice(checkIndex, checkIndex + hoursAhead).map((h) => h.precipitationMm);
}

async function runBacktestForPoint(point) {
  const { startDate, endDate } = getDateRange();
  const result = await fetchHistoricalHourlyPrecipitation(point.lat, point.lng, startDate, endDate);
  if (result.status !== "ok") {
    return { point, error: "過去データの取得に失敗しました" };
  }

  const hourly = result.hourly;
  const events = splitIntoRainfallEvents(hourly, IETD_HOURS);
  const rainyDayCount = new Set(
    hourly.filter((h) => h.precipitationMm !== null && h.precipitationMm > 0).map((h) => h.time.slice(0, 10))
  ).size;

  // 各methodごとに、1時間おきに「その時点で分かった予報」で評価する
  const perMethodRecords = Object.fromEntries(ALL_METHOD_IDS.map((m) => [m, []]));
  const perMethodStates = Object.fromEntries(ALL_METHOD_IDS.map((m) => [m, initialNotificationPointState()]));

  for (let i = 0; i < hourly.length - 6; i++) {
    const hourlyWindow = windowAt(hourly, i, 6);
    const forecast = {
      fetchedAt: hourly[i].time,
      hourlyRainfallMm: hourlyWindow,
      contentHash: hashForecastContent(hourlyWindow),
    };

    for (const method of ALL_METHOD_IDS) {
      const evalResult = evaluateMethod(method, {
        staticFloodHazardStatus: point.assumedHazard,
        forecast,
        previousState: perMethodStates[method],
        config: EXPERIMENT_CONFIG,
      });
      perMethodStates[method] = evalResult.updatedState;
      perMethodRecords[method].push({
        timestamp: hourly[i].time,
        isCandidate: evalResult.isCandidate,
        rainCondition: evalResult.rainCondition,
      });
    }
  }

  const baselineCandidateCount = perMethodRecords["hazard_and_rain"].filter((r) => r.isCandidate).length;

  const metricsByMethod = {};
  for (const method of ALL_METHOD_IDS) {
    metricsByMethod[method] = computeExperimentMetrics({
      records: perMethodRecords[method],
      baselineCandidateCount,
      events,
      weakRainPeakThresholdMm: WEAK_RAIN_PEAK_THRESHOLD_MM,
      rainyDayCount,
    });
  }

  return {
    point,
    period: { startDate, endDate },
    hoursFetched: hourly.length,
    rainfallEvents: events.length,
    rainyDayCount,
    metricsByMethod,
  };
}

async function main() {
  const results = [];
  for (const point of TEST_POINTS) {
    console.log(`--- ${point.label} (${point.id}) を処理中 ---`);
    const result = await runBacktestForPoint(point);
    results.push(result);
    console.log(JSON.stringify(result.metricsByMethod, null, 2));
  }

  const outDir = __dirname;
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "notification-backtest-results.json");
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        note: "技術確認用のBacktest結果。本実験地点・最終閾値ではない(scripts/research-data/notification-backtest.mjs冒頭コメント参照)。",
        experimentConfig: EXPERIMENT_CONFIG,
        ietdHours: IETD_HOURS,
        results,
      },
      null,
      2
    )
  );
  console.log(`結果を書き出しました: ${outPath}`);
}

main().catch((err) => {
  console.error("Backtestの実行に失敗しました:", err);
  process.exit(1);
});
