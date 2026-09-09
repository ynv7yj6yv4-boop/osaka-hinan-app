// 要件定義書3 docs/notification-backtest-experiment-design.md §4・5・7:
// バッチ1(Period C)・バッチ2(Period B)で取得済みのForecast Run Datasetを使い、
// 継続性条件9パターン × Method1〜4 × 2期間の本Backtestを実行する。
//
// 【重要・IETDについて】当初設計(§5)ではIETD(3h/6h)も感度分析の軸に含める
// 予定だったが、IETDはHistorical Forecast API由来の連続時間別降水量配列
// (Rain Event Dataset)を分割するための値であり、今回のSingle Runs API由来の
// Forecast Run Dataset(run単位のスナップショット)には適用できないことが
// 判明したため、人間側の承認を得てIETDは今回のBacktestから除外した
// (要件定義書3 §53・54のデータセット役割分離どおり)。
//
// 追加のAPI呼び出しは一切行わない(取得済みデータの再評価のみ)。
//
// 実行方法: node scripts/research-data/run-notification-backtest.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execSync } from "node:child_process";

import {
  initialNotificationPointState,
  evaluateMethod,
  hashForecastContent,
  ALL_METHOD_IDS,
} from "../../lib/notificationExperiment.ts";
import { toBacktestHazardStatusLabel } from "../../lib/staticFloodHazardCapture.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 雨量閾値。Set C(1h=30/3h=60/6h=90、docs §2)→ Set B(1h=20/3h=40/6h=60)の順に
// 実データで比較した結果、Set Cは全パターンでcandidate 0件、Set Bは継続性条件を
// 2以上にした瞬間に一気に0件になり、段階的な傾向が見えなかった。
// Set A(1h=10/3h=20/6h=30、やや強い雨基準)で比較したところ、継続性条件を
// 厳しくするほど候補数が滑らかに減少する(例: Period B 29→6→0)、研究として
// 有用な段階的傾向が見られたため、人間側承認によりSet Aを最終採用する。
const RAINFALL_THRESHOLDS = {
  hourlyRainfallThresholdMm: 10,
  accumulated3hThresholdMm: 20,
  accumulated6hThresholdMm: 30,
};

// 継続性条件、全9パターン(docs §4)。IETDは含めない(上記コメント参照)。
const PERSISTENCE_PATTERNS = [];
for (const forecastHours of [1, 2, 3]) {
  for (const runCount of [1, 2, 3]) {
    PERSISTENCE_PATTERNS.push({
      configId: `persistence-fh${forecastHours}-rr${runCount}`,
      requiredConsecutiveForecastHours: forecastHours,
      requiredConsecutiveRuns: runCount,
    });
  }
}

const PERIOD_FILES = {
  C: "forecast-run-dataset-period-c-post-api-start.json",
  B: "forecast-run-dataset-period-b-baiu.json",
};

function resolveGitCommit() {
  try {
    return execSync("git rev-parse HEAD").toString().trim();
  } catch {
    return "unknown";
  }
}

function loadFloodStatusByPoint() {
  const dataset = JSON.parse(
    readFileSync(path.join(__dirname, "static-flood-hazard-points.json"), "utf-8")
  );
  const map = new Map();
  for (const p of dataset.points) {
    if (p.technicalVerificationOnly === false) map.set(p.pointId, p.floodStatus);
  }
  return map;
}

function loadPointMetadata() {
  const data = JSON.parse(readFileSync(path.join(__dirname, "research-monitoring-points.json"), "utf-8"));
  const map = new Map();
  for (const p of data.points) {
    if (p.technicalVerificationOnly === false) map.set(p.pointId, { stratum: p.stratum, wardName: p.wardName });
  }
  return map;
}

function toSnapshot(run) {
  // 【重要・バグ修正】保存されているhourlyPrecipitationMmは7要素([0]=run初期化時刻
  // そのもの、常にnull。[1]〜[6]が実際の次の1〜6時間分、§51参照)。
  // checkRainCondition/accumulateRainfallはhourlyRainfallMm[0]を「次の1時間」として
  // 扱う設計(notification-run-verification.mjsのtoSnapshot()と同じ規約)のため、
  // 先頭の常にnullな要素を取り除いてから渡す必要がある。
  // これを行わず7要素のまま渡すと、[0]が常にnullのためnext1hが常にnullになり、
  // 3h/6h集計も欠測ありでnullになり、全run・全地点・全方式でcandidateが
  // 一切発生しない(insufficient_data扱いになる)という不具合になる
  // (実際に一度この不具合入りで実行し、全結果が0件になったことで発覚・修正した)。
  const hourlyRainfallMm =
    run.status === "ok" ? run.hourlyPrecipitationMm.slice(1) : [null, null, null, null, null, null];
  return {
    fetchedAt: run.fetchedAt,
    hourlyRainfallMm,
    runInitialisationTime: run.runInitialisationTime,
    contentHash: hashForecastContent(hourlyRainfallMm),
  };
}

function evaluatePointForConfig(runs, staticFloodHazardStatus, persistenceConfig, method) {
  const config = { configId: persistenceConfig.configId, ...RAINFALL_THRESHOLDS, ...persistenceConfig };
  let state = initialNotificationPointState();
  let candidateCount = 0;
  let runsFailed = 0;
  for (const run of runs) {
    if (run.status !== "ok") runsFailed++;
    const snapshot = toSnapshot(run);
    const result = evaluateMethod(method, { staticFloodHazardStatus, forecast: snapshot, previousState: state, config });
    state = result.updatedState;
    if (result.isCandidate) candidateCount++;
  }
  return { candidateCount, runsEvaluated: runs.length, runsFailed };
}

function main() {
  const floodStatusByPoint = loadFloodStatusByPoint();
  const pointMeta = loadPointMetadata();
  const generatedAt = new Date().toISOString();
  const gitCommit = resolveGitCommit();

  const results = [];

  for (const periodKey of Object.keys(PERIOD_FILES)) {
    const dataset = JSON.parse(readFileSync(path.join(__dirname, PERIOD_FILES[periodKey]), "utf-8"));

    // pointIdごとにrunを集約し、run初期化時刻順に並べる(状態機構の時系列評価に必要)
    const runsByPoint = new Map();
    for (const r of dataset.runs) {
      if (!runsByPoint.has(r.pointId)) runsByPoint.set(r.pointId, []);
      runsByPoint.get(r.pointId).push(r);
    }
    for (const runs of runsByPoint.values()) {
      runs.sort((a, b) => (a.runInitialisationTime < b.runInitialisationTime ? -1 : 1));
    }

    for (const persistenceConfig of PERSISTENCE_PATTERNS) {
      for (const method of ALL_METHOD_IDS) {
        const perPoint = [];
        let totalCandidates = 0;
        let totalRuns = 0;

        for (const [pointId, runs] of runsByPoint.entries()) {
          const floodStatus = floodStatusByPoint.get(pointId);
          const { candidateCount, runsEvaluated, runsFailed } = evaluatePointForConfig(
            runs,
            floodStatus,
            persistenceConfig,
            method
          );
          const meta = pointMeta.get(pointId) ?? {};
          perPoint.push({
            pointId,
            stratum: meta.stratum ?? null,
            wardName: meta.wardName ?? null,
            staticFloodHazardStatus: toBacktestHazardStatusLabel(floodStatus),
            candidateCount,
            runsEvaluated,
            runsFailed,
          });
          totalCandidates += candidateCount;
          totalRuns += runsEvaluated;
        }

        results.push({
          period: periodKey,
          method,
          configId: persistenceConfig.configId,
          requiredConsecutiveForecastHours: persistenceConfig.requiredConsecutiveForecastHours,
          requiredConsecutiveRuns: persistenceConfig.requiredConsecutiveRuns,
          totalCandidates,
          totalRuns,
          perPoint,
        });
      }
    }
    console.log(`Period ${periodKey}: ${runsByPoint.size}地点 × ${PERSISTENCE_PATTERNS.length}パターン × ${ALL_METHOD_IDS.length}方式 の評価完了`);
  }

  const output = {
    metadata: {
      generatedAt,
      gitCommit,
      rainfallThresholdSet: "Set A(やや強い雨基準)・最終採用",
      rainfallThresholds: RAINFALL_THRESHOLDS,
      persistencePatterns: PERSISTENCE_PATTERNS,
      status: "final",
      note:
        "docs/notification-backtest-experiment-design.md に基づく本Backtest(最終版)。" +
        "雨量閾値はSet C(1h=30/3h=60/6h=90、全パターン0件)→Set B(1h=20/3h=40/6h=60、" +
        "継続性条件2以上で一気に0件)の順に実データで比較した結果、Set A" +
        "(1h=10/3h=20/6h=30)で継続性条件を厳しくするほど候補数が滑らかに減少する" +
        "(例: Period B 29→6→0)、研究として有用な段階的傾向が見られたため、" +
        "人間側承認によりSet Aを最終採用した。" +
        "継続性条件は1つの値に決め打ちせず、9パターン全てを感度分析結果として" +
        "採用する(人間側承認済み)。IETDは今回のBacktestには含めない" +
        "(Single Runs API由来のForecast Run Datasetには適用できないため、" +
        "人間側承認済み。Method1〜4の比較という主目的には影響しない)。" +
        "対象期間はPeriod C・Period Bの現状2期間で確定し、延長しない" +
        "(人間側承認済み)。追加のAPI呼び出しは行っていない" +
        "(取得済みデータの再評価のみ)。雨量閾値・継続性条件・本実験期間は" +
        "本Backtestの評価条件として確定したが、卒論の最終採用値そのもの" +
        "(単一の推奨方式・推奨閾値)は、この感度分析結果を踏まえて別途決定する。",
      sourceDatasets: {
        periodC: "scripts/research-data/forecast-run-dataset-period-c-post-api-start.json",
        periodB: "scripts/research-data/forecast-run-dataset-period-b-baiu.json",
      },
    },
    results,
  };

  const outPath = path.join(__dirname, "notification-backtest-experiment-results.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`結果を書き出しました: ${outPath}`);
}

main();
