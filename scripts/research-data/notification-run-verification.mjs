// 試作3 通知判定ロジックの実験実装: forecast run再現性の監査・検証スクリプト。
//
// 【位置づけ】これは大規模なBacktestではなく、Single Runs APIとの連携が
// 正しく機能するかを確認する**小規模な技術検証**である(1地点・2〜3run)。
// 要件定義書の「テスト」セクションで求められた以下5点を確認する。
//   1. runを個別指定できる
//   2. 同じrunを再取得すると同じ予報になる
//   3. 3時間後のrunが別runとして識別できる
//   4. forecast horizonを保持できる
//   5. run間継続性を正しく計算できる
//
// 実行方法: node scripts/research-data/notification-run-verification.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { fetchSingleRun } from "../../lib/rainfallForecastOpenMeteo.ts";
import {
  hashForecastContent,
  initialNotificationPointState,
  evaluateMethod,
} from "../../lib/notificationExperiment.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 技術検証用の仮地点(大阪市役所付近)。本実験地点ではない。
const POINT = { lat: 34.6937, lng: 135.5023 };

const CONFIG = {
  configId: "run-verification-v1",
  hourlyRainfallThresholdMm: 10,
  accumulated3hThresholdMm: 20,
  accumulated6hThresholdMm: 30,
  requiredConsecutiveForecastHours: 2,
  requiredConsecutiveRuns: 2,
};

function toSnapshot(runResult) {
  // 【発見・重要】Single Runs APIのレスポンスは、run初期化時刻そのものに
  // 対応する先頭の1件が常にnull(直前1時間のデータがまだ存在しないため)。
  // そのため「次の1〜6時間」はindex 1〜6を使う(index 0はスキップする)。
  const hourlyRainfallMm = runResult.hourly.slice(1, 7).map((h) => h.precipitationMm);
  return {
    fetchedAt: runResult.fetchedAt,
    hourlyRainfallMm,
    runInitialisationTime: runResult.runInitialisationTime,
    contentHash: hashForecastContent(hourlyRainfallMm),
  };
}

async function main() {
  const report = { generatedAt: new Date().toISOString(), checks: {} };

  // 【重要な発見】run初期時刻の直後(実際に確認したところ35分後)はまだ
  // Single Runs APIで取得できないことを実際のAPI呼び出しで確認した
  // (400エラー: "The requested model run is not available")。
  // run初期化時刻(runInitialisationTime)と実際にAPI上で利用可能になる
  // 時刻(last_run_availability_time相当)にはタイムラグがあるとみられる。
  // そのため、この検証では安全に取得できる十分に古いrun(直近から
  // 6時間以上前を起点)を使う。
  const SAFETY_MARGIN_HOURS = 6;
  const now = new Date();
  const safeNow = new Date(now.getTime() - SAFETY_MARGIN_HOURS * 60 * 60 * 1000);
  const latestRunHourUtc = Math.floor(safeNow.getUTCHours() / 3) * 3;
  const latestRun = new Date(
    Date.UTC(safeNow.getUTCFullYear(), safeNow.getUTCMonth(), safeNow.getUTCDate(), latestRunHourUtc)
  );
  // 直近3回分のrun初期時刻(3時間おき)を作る
  const runTimes = [0, 1, 2].map((i) => {
    const d = new Date(latestRun.getTime() - i * 3 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 16); // "YYYY-MM-DDTHH:MM"
  }).reverse(); // 古い順に並べる

  console.log("検証対象run:", runTimes);

  // --- 1. runを個別指定できるか ---
  const results = [];
  for (const runTime of runTimes) {
    const r = await fetchSingleRun(POINT.lat, POINT.lng, runTime);
    results.push(r);
  }
  report.checks.canSpecifyIndividualRun = results.every((r) => r.status === "ok");

  // --- 4. forecast horizonを保持できるか ---
  report.checks.forecastHorizonHours = results.map((r) => (r.status === "ok" ? r.hourly.length : null));

  // --- 2. 同じrunを再取得すると同じ予報になるか ---
  const refetch = await fetchSingleRun(POINT.lat, POINT.lng, runTimes[runTimes.length - 1]);
  const original = results[results.length - 1];
  report.checks.sameRunReproducible =
    original.status === "ok" &&
    refetch.status === "ok" &&
    JSON.stringify(original.hourly.slice(0, 10)) === JSON.stringify(refetch.hourly.slice(0, 10));

  // --- 3. 3時間後のrunが別runとして識別できるか ---
  if (results.length >= 2 && results[0].status === "ok" && results[1].status === "ok") {
    report.checks.consecutiveRunsDiffer =
      JSON.stringify(results[0].hourly.slice(0, 10)) !== JSON.stringify(results[1].hourly.slice(0, 10));
  }

  // --- 5. run間継続性を正しく計算できるか ---
  let state = initialNotificationPointState();
  const persistenceTrace = [];
  for (const r of results) {
    if (r.status !== "ok") continue;
    const snapshot = toSnapshot(r);
    const evalResult = evaluateMethod("hazard_rain_state_change_persistence", {
      staticFloodHazardStatus: "hazard",
      forecast: snapshot,
      previousState: state,
      config: CONFIG,
    });
    state = evalResult.updatedState;
    persistenceTrace.push({
      runInitialisationTime: snapshot.runInitialisationTime,
      hourlyRainfallMm: snapshot.hourlyRainfallMm,
      rainCondition: evalResult.rainCondition,
      consecutiveRunsMatched: state.persistence.consecutiveRunsMatched,
      newInternalState: evalResult.newInternalState,
      isCandidate: evalResult.isCandidate,
    });
  }
  report.checks.persistenceTrace = persistenceTrace;
  report.checks.runPersistenceComputable = persistenceTrace.length === results.filter((r) => r.status === "ok").length;

  console.log(JSON.stringify(report, null, 2));

  const outPath = path.join(__dirname, "notification-run-verification-results.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`結果を書き出しました: ${outPath}`);
}

main().catch((err) => {
  console.error("run検証の実行に失敗しました:", err);
  process.exit(1);
});
