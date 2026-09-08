// 要件定義書3 docs/research-location-sampling-design.md §11・12・13・14:
// candidate-population-classification.json（既存判定による機械分類済み、
// 結果を見た選定ではない）から、seed固定の層化無作為抽出で本実験地点を確定する。
//
// 【重要・最重要ルール】
// - Backtestの結果を一切参照しない(まだBacktestを実行していない)。
// - hazard/outsideの各stratumから、事前に固定したseedのみで機械的に抽出する。
// - 1区あたり同一stratum最大2件までという空間偏り対策を適用する(docs §12)。
// - 抽出後の地点をBacktest結果を見て入れ替えることはしない。
//
// 実行方法: node scripts/research-data/generate-experiment-points.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execSync } from "node:child_process";

import { createSeededRandom, seededShuffle } from "../../lib/seededRandom.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// docs/research-location-sampling-design.md 承認コミットのハッシュ(ace1777...)由来。
// 【重要】この値は結果を見て選んだものではない。承認済み・公開済みのGit commitから
// 機械的に導出したもの(先頭8桁の16進数をそのまま10進数化)。
const SAMPLING_SEED = 2900457335;
const SAMPLING_SEED_SOURCE = "docs/research-location-sampling-design.md 承認コミット ace1777749aa8208b2d207ceca0de70f3dc2725f の先頭8桁(hex)を10進数化";
const SAMPLING_METHOD = "ward-capped-stratified-random-sampling-v1"; // docs §11・12
const MAX_PER_WARD_PER_STRATUM = 2; // docs §12
const TARGET_PER_STRATUM = 12; // docs §6 Plan B-24A

const CLASSIFICATION_PATH = path.join(__dirname, "candidate-population-classification.json");
const RESEARCH_POINTS_PATH = path.join(__dirname, "research-monitoring-points.json");
const SHELTERS_PATH = path.join(__dirname, "..", "..", "public", "data", "osaka-shelters.json");
const DATA_QUALITY_PATH = path.join(__dirname, "candidate-population-data-quality.json");
const EXCLUDED_PATH = path.join(__dirname, "excluded-candidate-points.json");

function resolveGitCommit() {
  try {
    return execSync("git rev-parse HEAD").toString().trim();
  } catch {
    return "unknown";
  }
}

function pickStratified(pool, maxPerWard, target, random) {
  const shuffled = seededShuffle(pool, random);
  const wardCounts = new Map();
  const picked = [];
  for (const candidate of shuffled) {
    if (picked.length >= target) break;
    const count = wardCounts.get(candidate.ward) ?? 0;
    if (count >= maxPerWard) continue;
    picked.push(candidate);
    wardCounts.set(candidate.ward, count + 1);
  }
  return { picked, shortfall: Math.max(0, target - picked.length) };
}

// docs/research-location-sampling-design.md §9: データセット名+公開日+ファイルハッシュから
// 一意なcandidatePopulationVersion文字列を合成する。
function buildCandidatePopulationVersion(metadata) {
  const shortHash = String(metadata.fileHash ?? "unknown").slice(0, 12);
  return `osaka-shelters-flood-capable-${metadata.sourcePublicationDate}-sha256:${shortHash}`;
}

function main() {
  const classification = JSON.parse(readFileSync(CLASSIFICATION_PATH, "utf-8"));
  const { candidates } = classification;
  const candidatePopulationVersion = buildCandidatePopulationVersion(classification.metadata);

  const hazardPool = candidates.filter((c) => c.floodStatus === "hazard");
  const outsidePool = candidates.filter((c) => c.floodStatus === "outside");
  const unknownPool = candidates.filter((c) => c.floodStatus === "unknown");

  // hazard/outsideは独立したrandomストリームを使う(片方の抽出がもう片方へ影響しないように、
  // 同じseedから別々の乱数生成器を作る。互いの抽出順序に依存関係を持たせない)。
  const hazardRandom = createSeededRandom(SAMPLING_SEED);
  const outsideRandom = createSeededRandom(SAMPLING_SEED + 1); // hazardと明確に区別した固定値

  const hazardResult = pickStratified(hazardPool, MAX_PER_WARD_PER_STRATUM, TARGET_PER_STRATUM, hazardRandom);
  const outsideResult = pickStratified(outsidePool, MAX_PER_WARD_PER_STRATUM, TARGET_PER_STRATUM, outsideRandom);

  if (hazardResult.shortfall > 0 || outsideResult.shortfall > 0) {
    console.error(
      `[警告] 目標地点数に届きませんでした(hazard不足=${hazardResult.shortfall}, outside不足=${outsideResult.shortfall})。` +
        "1区あたりの上限を緩めるか、目標地点数の見直しが必要です。地点ファイルは生成しません。"
    );
    process.exit(1);
  }

  const generatedAt = new Date().toISOString();
  const gitCommit = resolveGitCommit();

  const selectedHazard = hazardResult.picked.map((c, i) => ({ ...c, pointId: `E${String(i + 1).padStart(3, "0")}`, stratum: "hazard" }));
  const selectedOutside = outsideResult.picked.map((c, i) => ({
    ...c,
    pointId: `E${String(i + 1 + TARGET_PER_STRATUM).padStart(3, "0")}`,
    stratum: "outside",
  }));
  const selected = [...selectedHazard, ...selectedOutside];

  const newExperimentPoints = selected.map((c) => ({
    pointId: c.pointId,
    latitude: c.latitude,
    longitude: c.longitude,
    selectionGroup: `experiment_${c.stratum}_stratum`,
    selectionReason: `候補: 洪水対応指定緊急避難場所データ(${c.ward})。samplingMethod=${SAMPLING_METHOD}, samplingSeed(${c.stratum})=${
      c.stratum === "hazard" ? SAMPLING_SEED : SAMPLING_SEED + 1
    }による層化無作為抽出。`,
    selectedBeforeExperiment: true,
    selectedAt: generatedAt,
    technicalVerificationOnly: false,
    samplingMethod: SAMPLING_METHOD,
    samplingSeed: c.stratum === "hazard" ? SAMPLING_SEED : SAMPLING_SEED + 1,
    candidatePopulationVersion: candidatePopulationVersion,
    stratum: c.stratum,
    wardName: c.ward,
  }));

  // --- research-monitoring-points.json へ追記(既存のP001〜P004technical verification地点は保持) ---
  const existing = JSON.parse(readFileSync(RESEARCH_POINTS_PATH, "utf-8"));
  const existingIds = new Set(existing.points.map((p) => p.pointId));
  for (const p of newExperimentPoints) {
    if (existingIds.has(p.pointId)) throw new Error(`pointId重複: ${p.pointId}`);
  }
  existing.points.push(...newExperimentPoints);
  existing.metadata.experimentPointsFinalized = true;
  existing.metadata.notes +=
    ` [${generatedAt}] E001〜E024(本実験地点、technicalVerificationOnly=false)を追加。` +
    `Plan B-24A(hazard12+outside12)、samplingMethod=${SAMPLING_METHOD}、` +
    `samplingSeed(hazard)=${SAMPLING_SEED}・samplingSeed(outside)=${SAMPLING_SEED + 1}` +
    `（${SAMPLING_SEED_SOURCE}。outsideはhazardの値+1という区別のみ）、` +
    `candidatePopulationVersion=${candidatePopulationVersion}。` +
    `Backtest結果はまだ参照していない(地点確定はBacktest実行前)。`;
  writeFileSync(RESEARCH_POINTS_PATH, JSON.stringify(existing, null, 2));
  console.log(`research-monitoring-points.json を更新しました(E001〜E024を追加、計${existing.points.length}地点)`);

  // --- Data Quality Dataset(unknown)の集計 ---
  const reasonBreakdown = {};
  for (const c of unknownPool) {
    const key = c.floodStatusReason ?? "other";
    reasonBreakdown[key] = (reasonBreakdown[key] ?? 0) + 1;
  }
  const dataQuality = {
    generatedAt,
    gitCommit,
    purpose:
      "candidate population(洪水対応指定緊急避難場所)全数の機械分類のうち、floodStatus=unknownだった地点の" +
      "データ品質集計。本実験の主解析(hazard/outside比較)には含めない(docs §7)。",
    candidatePopulationCount: candidates.length,
    unknownCount: unknownPool.length,
    unknownRatio: candidates.length > 0 ? unknownPool.length / candidates.length : null,
    unknownReasonBreakdown: reasonBreakdown,
    unknownPoints: unknownPool.map((c) => ({
      id: c.id,
      latitude: c.latitude,
      longitude: c.longitude,
      ward: c.ward,
      name: c.name,
      floodStatusReason: c.floodStatusReason,
    })),
  };
  writeFileSync(DATA_QUALITY_PATH, JSON.stringify(dataQuality, null, 2));
  console.log(`candidate-population-data-quality.json を書き出しました(unknown ${unknownPool.length}件)`);

  // --- 除外ログ(住所からward抽出できなかった候補。§13) ---
  const sheltersRaw = readFileSync(SHELTERS_PATH, "utf-8");
  const shelters = JSON.parse(sheltersRaw);
  const wardPattern = /^大阪府大阪市(\S+?区)/;
  const excluded = shelters.features
    .filter((f) => f.type === "evacuation_site" && Array.isArray(f.hazards) && f.hazards.includes("flood"))
    .filter((f) => !wardPattern.test(f.address))
    .map((f) => ({
      id: f.id,
      name: f.name,
      address: f.address,
      latitude: f.lat,
      longitude: f.lng,
      reason: "ward_extraction_failed_or_ambiguous_municipality",
      excludedAt: generatedAt,
    }));
  writeFileSync(EXCLUDED_PATH, JSON.stringify({ generatedAt, gitCommit, excluded }, null, 2));
  console.log(`excluded-candidate-points.json を書き出しました(除外 ${excluded.length}件)`);

  // --- サマリ表示 ---
  console.log("\n=== 抽出サマリ ===");
  console.log("hazard抽出地点:", selectedHazard.map((c) => `${c.pointId}(${c.ward})`).join(", "));
  console.log("outside抽出地点:", selectedOutside.map((c) => `${c.pointId}(${c.ward})`).join(", "));
}

main();
