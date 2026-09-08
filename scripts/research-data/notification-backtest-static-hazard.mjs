// 試作3 要件定義書3 §71〜73 PART L・M・O・S: staticFloodHazard固定JSON
// (scripts/research-data/static-flood-hazard-points.json) と
// Single Runs API(Forecast Run Dataset)を接続した、一気通貫パイプラインの
// Notification Backtest。
//
// 地点 → 既存mvp洪水判定(固定JSON) → Single Runs Forecast → Method1〜4
// という要件定義書3 §71の流れを実際に一度通す、技術確認用スクリプトである。
//
// 【重要・データセットの役割分離(§53・54・PART S)】
// このスクリプトはSingle Runs API(Forecast Run Dataset用)のみを使う。
// Historical Forecast API(Rain Event Dataset用。雨天日・IETD・降雨イベント抽出)
// とは役割を混同しない。過去のnotification-backtest.mjs
// (Historical Forecast API + 仮定hazard)は技術確認用の履歴として別途残しており、
// このスクリプトが置き換えるものではない(要件定義書3 §14参照)。
//
// 【重要・このスクリプトの位置づけ】
// - 技術確認用: 「固定JSON→Single Runs→Method1〜4」が一気通貫で動くかの確認。
// - 卒論本実験結果ではない。本実験地点・本実験期間・雨量閾値・IETDは
//   まだ人間側で決定していない(要件定義書3 §68・69・59)。
// - staticFloodHazardは、static-flood-hazard-points.json（方式Bで生成した固定データ）
//   をそのまま使う。ここでhazardを仮定・再計算することは一切しない(PART L)。
//
// 実行方法: node scripts/research-data/notification-backtest-static-hazard.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { fetchSingleRun } from "../../lib/rainfallForecastOpenMeteo.ts";
import { initialNotificationPointState, evaluateMethod, hashForecastContent, ALL_METHOD_IDS } from "../../lib/notificationExperiment.ts";
import { toBacktestHazardStatusLabel } from "../../lib/staticFloodHazardCapture.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_HAZARD_PATH = path.join(__dirname, "static-flood-hazard-points.json");

// 実験パラメータ(§59参照)。技術確認用の仮値であり、最終採用値ではない。
const EXPERIMENT_CONFIG = {
  configId: "static-hazard-single-runs-technical-check-v1",
  hourlyRainfallThresholdMm: 10,
  accumulated3hThresholdMm: 20,
  accumulated6hThresholdMm: 30,
  requiredConsecutiveForecastHours: 2,
  requiredConsecutiveRuns: 2,
};

// notification-run-verification.mjsと同じ理由(run初期化直後はSingle Runs APIで
// まだ取得できないタイムラグがある。§50参照)で、十分に古いrunのみを使う。
const SAFETY_MARGIN_HOURS = 6;
const RUN_COUNT = 3;

function loadStaticHazardDataset() {
  let raw;
  try {
    raw = readFileSync(STATIC_HAZARD_PATH, "utf-8");
  } catch {
    throw new Error(
      `固定JSONが見つかりません: ${STATIC_HAZARD_PATH}\n` +
        "先に app/dev/static-flood-hazard-capture ページ(要 NEXT_PUBLIC_ENABLE_DEV_TOOLS=1)で" +
        "staticFloodHazardを生成してください。"
    );
  }
  return JSON.parse(raw);
}

function recentRunTimes(count) {
  const now = new Date();
  const safeNow = new Date(now.getTime() - SAFETY_MARGIN_HOURS * 60 * 60 * 1000);
  const latestRunHourUtc = Math.floor(safeNow.getUTCHours() / 3) * 3;
  const latestRun = new Date(
    Date.UTC(safeNow.getUTCFullYear(), safeNow.getUTCMonth(), safeNow.getUTCDate(), latestRunHourUtc)
  );
  return Array.from({ length: count }, (_, i) =>
    new Date(latestRun.getTime() - (count - 1 - i) * 3 * 60 * 60 * 1000).toISOString().slice(0, 16)
  );
}

function toSnapshot(runResult) {
  // Single Runs APIレスポンス先頭(run初期化時刻そのもの)は常にnull(§51)。
  // 「次の1〜6時間」はindex 1〜6を使う(notification-run-verification.mjsと同じ扱い)。
  const hourlyRainfallMm = runResult.hourly.slice(1, 7).map((h) => h.precipitationMm);
  return {
    fetchedAt: runResult.fetchedAt,
    hourlyRainfallMm,
    runInitialisationTime: runResult.runInitialisationTime,
    contentHash: hashForecastContent(hourlyRainfallMm),
  };
}

async function runForPoint(point, runTimes) {
  const staticFloodHazardStatus = point.floodStatus; // PART L: 固定JSONの値をそのまま使う(再計算しない)

  const runResults = [];
  for (const runTime of runTimes) {
    runResults.push(await fetchSingleRun(point.latitude, point.longitude, runTime));
  }

  const perMethodStates = Object.fromEntries(ALL_METHOD_IDS.map((m) => [m, initialNotificationPointState()]));
  const perMethodTrace = Object.fromEntries(ALL_METHOD_IDS.map((m) => [m, []]));

  for (const runResult of runResults) {
    if (runResult.status !== "ok") {
      for (const method of ALL_METHOD_IDS) {
        perMethodTrace[method].push({ runInitialisationTime: runResult.runInitialisationTime, error: "run取得失敗" });
      }
      continue;
    }
    const snapshot = toSnapshot(runResult);
    for (const method of ALL_METHOD_IDS) {
      const evalResult = evaluateMethod(method, {
        staticFloodHazardStatus,
        forecast: snapshot,
        previousState: perMethodStates[method],
        config: EXPERIMENT_CONFIG,
      });
      perMethodStates[method] = evalResult.updatedState;
      perMethodTrace[method].push({
        runInitialisationTime: snapshot.runInitialisationTime,
        hourlyRainfallMm: snapshot.hourlyRainfallMm,
        rainCondition: evalResult.rainCondition,
        forecastInternalPersistenceMet: evalResult.forecastInternalPersistenceMet,
        forecastRunPersistenceMet: evalResult.forecastRunPersistenceMet,
        newInternalState: evalResult.newInternalState,
        isCandidate: evalResult.isCandidate,
        reason: evalResult.reason,
      });
    }
  }

  return {
    pointId: point.pointId,
    latitude: point.latitude,
    longitude: point.longitude,
    // 技術確認2回目の追記: 固定JSON側のtechnicalVerificationOnlyをそのまま引き継ぎ、
    // Backtest結果上でも本実験データと明確に区別できるようにする。
    technicalVerificationOnly: point.technicalVerificationOnly,
    // §15 PART N: レポート上はunknownをinsufficient_dataとして表示する
    // (evaluateMethod自体の候補判定ロジックは既にunknownを候補にしない設計)。
    staticFloodHazardStatus: toBacktestHazardStatusLabel(staticFloodHazardStatus),
    staticFloodDepthRank: point.depthRank,
    runsAttempted: runTimes.length,
    runsOk: runResults.filter((r) => r.status === "ok").length,
    perMethodTrace,
  };
}

async function main() {
  const dataset = loadStaticHazardDataset();
  const runTimes = recentRunTimes(RUN_COUNT);
  console.log("使用run:", runTimes);
  console.log(`固定JSON: ${dataset.metadata.generatedAt} (gitCommit=${dataset.metadata.gitCommit}) の ${dataset.points.length}地点を使用`);

  const results = [];
  for (const point of dataset.points) {
    console.log(`--- ${point.pointId} (floodStatus=${point.floodStatus}) を処理中 ---`);
    results.push(await runForPoint(point, runTimes));
  }

  const output = {
    generatedAt: new Date().toISOString(),
    note:
      "技術確認用のBacktest結果(要件定義書3 §71 PART O)。地点→既存hazard判定(固定JSON)→Single Runs Forecast→Method1〜4" +
      "が一気通貫で動くことの確認が目的であり、卒論本実験結果ではない。本実験地点・期間・閾値は未決定(§68・69・59)。",
    experimentConfig: EXPERIMENT_CONFIG,
    staticFloodHazardSource: {
      path: "scripts/research-data/static-flood-hazard-points.json",
      generatedAt: dataset.metadata.generatedAt,
      gitCommit: dataset.metadata.gitCommit,
      ruleVersion: dataset.metadata.ruleVersion,
    },
    runTimesUsed: runTimes,
    results,
  };

  const outPath = path.join(__dirname, "notification-backtest-static-hazard-results.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`結果を書き出しました: ${outPath}`);
}

main().catch((err) => {
  console.error("Backtest(static hazard接続版)の実行に失敗しました:", err);
  process.exit(1);
});
