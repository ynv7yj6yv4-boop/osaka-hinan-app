// 要件定義書3 docs/notification-backtest-experiment-design.md §6・7:
// 本実験地点(E001〜E024)について、Single Runs APIからForecast Run Datasetを
// バッチ単位で取得・保存する。
//
// 【重要】ここでは降雨予測データを取得するだけで、Notification Backtestの
// 評価(Method1〜4)は行わない(評価は別スクリプトで、取得済みデータを
// 再利用して何度でもオフラインに行う。追加のAPI呼び出しは発生しない)。
//
// 【重要・レート制限】Open-Meteo無料枠は10,000回/日・5,000回/時・600回/分。
// Period C(5,760回)・Period B(6,720回)は、それぞれ単体では1日の上限内だが、
// 合計12,480回は超えるため、日をまたいで2バッチに分けて実行する
// (docs/notification-backtest-experiment-design.md §6・7)。
//
// 【再開可能性】既に取得済みの(pointId, runInitialisationTime)は再取得せず
// スキップする。ネットワーク中断等があっても、同じコマンドを再実行すれば
// 途中から再開できる。
//
// 実行方法: node scripts/research-data/fetch-forecast-run-dataset.mjs --period=C

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { fetchSingleRun } from "../../lib/rainfallForecastOpenMeteo.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESEARCH_POINTS_PATH = path.join(__dirname, "research-monitoring-points.json");

// docs/notification-backtest-experiment-design.md §1
// 【重要】Period Cは当初「2026-04-02」を起点としていたが、これは実データ検証前の
// コメントに基づく誤った前提だった。実際にAPIへ問い合わせたところ、jma_msmの
// Single Runs APIで取得できる最古のrunは2026-05-13だったため、それに合わせて改訂した
// (docs/notification-backtest-experiment-design.md 改訂履歴参照)。
const PERIODS = {
  B: { label: "period-b-baiu", startDate: "2026-06-04", endDate: "2026-07-08" },
  C: { label: "period-c-post-api-start", startDate: "2026-05-13", endDate: "2026-06-03" },
};

const RUN_HOURS_UTC = [0, 3, 6, 9, 12, 15, 18, 21]; // 3時間おき
const SAVE_EVERY = 25; // 25件ごとに途中経過を書き出す(中断耐性)
const RETRY_COUNT = 2;
const RETRY_DELAY_MS = 1500;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs() {
  const arg = process.argv.find((a) => a.startsWith("--period="));
  const period = arg ? arg.split("=")[1] : null;
  if (!period || !PERIODS[period]) {
    console.error("使用方法: node fetch-forecast-run-dataset.mjs --period=B もしくは --period=C");
    process.exit(1);
  }
  return period;
}

function enumerateRunTimes(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const runTimes = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    for (const h of RUN_HOURS_UTC) {
      const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h));
      runTimes.push(t.toISOString().slice(0, 16)); // "YYYY-MM-DDTHH:MM"
    }
  }
  return runTimes;
}

function loadExperimentPoints() {
  const data = JSON.parse(readFileSync(RESEARCH_POINTS_PATH, "utf-8"));
  return data.points.filter((p) => p.technicalVerificationOnly === false);
}

async function main() {
  const periodKey = parseArgs();
  const period = PERIODS[periodKey];
  const outPath = path.join(__dirname, `forecast-run-dataset-${period.label}.json`);

  const points = loadExperimentPoints();
  const runTimes = enumerateRunTimes(period.startDate, period.endDate);
  const totalCalls = points.length * runTimes.length;
  console.log(
    `period=${periodKey}(${period.startDate}〜${period.endDate}) points=${points.length} runs/point=${runTimes.length} ` +
      `total=${totalCalls}`
  );

  let dataset = { metadata: null, runs: [] };
  const doneKeys = new Set();
  if (existsSync(outPath)) {
    dataset = JSON.parse(readFileSync(outPath, "utf-8"));
    for (const r of dataset.runs) doneKeys.add(`${r.pointId}__${r.runInitialisationTime}`);
    console.log(`既存の取得済みデータ ${dataset.runs.length}件を検出。続きから再開します。`);
  }

  let processedSinceLastSave = 0;
  let okCount = 0;
  let failCount = 0;

  for (const point of points) {
    for (const runTime of runTimes) {
      const key = `${point.pointId}__${runTime}`;
      if (doneKeys.has(key)) continue;

      let result = null;
      for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
        result = await fetchSingleRun(point.latitude, point.longitude, runTime);
        if (result.status === "ok") break;
        if (attempt < RETRY_COUNT) await sleep(RETRY_DELAY_MS);
      }

      if (result.status === "ok") {
        okCount++;
        dataset.runs.push({
          pointId: point.pointId,
          latitude: point.latitude,
          longitude: point.longitude,
          runInitialisationTime: result.runInitialisationTime,
          fetchedAt: result.fetchedAt,
          status: "ok",
          // 【重要】Method1〜4の評価に必要なのは次の0〜6時間分のみ(index0は常にnull、
          // §51参照)。フル168時間分を保存すると容量が不要に大きくなるため、
          // 評価に必要な範囲だけを保存する(再現性に必要な情報は損なわない)。
          hourlyPrecipitationMm: result.hourly.slice(0, 7).map((h) => h.precipitationMm),
        });
      } else {
        failCount++;
        dataset.runs.push({
          pointId: point.pointId,
          latitude: point.latitude,
          longitude: point.longitude,
          runInitialisationTime: runTime,
          fetchedAt: result.fetchedAt,
          status: "unavailable",
          hourlyPrecipitationMm: null,
        });
      }
      doneKeys.add(key);
      processedSinceLastSave++;

      if (processedSinceLastSave >= SAVE_EVERY) {
        dataset.metadata = buildMetadata(periodKey, period, points, runTimes, okCount, failCount, false);
        writeFileSync(outPath, JSON.stringify(dataset, null, 2));
        processedSinceLastSave = 0;
        console.log(`進捗: ${dataset.runs.length} / ${totalCalls} (ok=${okCount}, fail=${failCount})`);
      }
    }
  }

  dataset.metadata = buildMetadata(periodKey, period, points, runTimes, okCount, failCount, true);
  writeFileSync(outPath, JSON.stringify(dataset, null, 2));
  console.log(`完了。保存先: ${outPath}`);
  console.log(`ok=${okCount}, fail=${failCount}, total=${dataset.runs.length}`);
}

function buildMetadata(periodKey, period, points, runTimes, okCount, failCount, complete) {
  return {
    generatedAt: new Date().toISOString(),
    periodKey,
    periodLabel: period.label,
    startDate: period.startDate,
    endDate: period.endDate,
    pointCount: points.length,
    runsPerPoint: runTimes.length,
    okCount,
    failCount,
    complete,
    note:
      "docs/notification-backtest-experiment-design.md §7のバッチ1(Period C)/バッチ2(Period B)に対応。" +
      "Method1〜4の評価はこのデータを再利用して別スクリプトで行う(追加のAPI呼び出しなし)。",
  };
}

main().catch((err) => {
  console.error("取得中にエラーが発生しました:", err);
  process.exit(1);
});
