// 試作3 要件定義書3 §71〜73: lib/staticFloodHazardCapture.ts の単体テスト。
// ネットワーク・ブラウザAPI不要（HazardPixelStatusを直接与えて変換ロジックのみ検証する）。

import { test } from "node:test";
import assert from "node:assert/strict";
import type { HazardPixelStatus } from "./hazardPixelClassifier.ts";
import {
  toStaticFloodHazardPointResult,
  toCaptureFailurePointResult,
  buildStaticFloodHazardDataset,
  toBacktestHazardStatusLabel,
} from "./staticFloodHazardCapture.ts";

const POINT = { pointId: "P001", latitude: 34.68, longitude: 135.5 };
const META = { evaluatedAt: "2026-09-08T00:00:00.000Z", systemVersion: "0.1.0", gitCommit: "abc1234" };

// 1. hazard地点保存
test("hazard判定はfloodStatus=hazardとして保存され、depthRank・ラベルを保持する", () => {
  const pixel: HazardPixelStatus = { status: "hazard", rank: 2 };
  const result = toStaticFloodHazardPointResult(POINT, pixel, META);
  assert.equal(result.floodStatus, "hazard");
  assert.equal(result.floodStatusReason, null);
  assert.equal(result.depthRank, 2);
  assert.equal(result.expectedDepthLabel, "0.5m〜3.0m");
  assert.equal(result.assessmentCompleteness, "complete");
});

// 2. outside地点保存
test("outside判定はfloodStatus=outsideとして保存される（安全とは表現しない中立な保存）", () => {
  const pixel: HazardPixelStatus = { status: "outside" };
  const result = toStaticFloodHazardPointResult(POINT, pixel, META);
  assert.equal(result.floodStatus, "outside");
  assert.equal(result.depthRank, 0);
  assert.equal(result.assessmentCompleteness, "complete");
});

// 3・4. unknown保持・404をoutsideにしない
test("no_tile(404)はunknownとして保持し、outsideや0には変換しない", () => {
  const pixel: HazardPixelStatus = { status: "unknown", reason: "no_tile" };
  const result = toStaticFloodHazardPointResult(POINT, pixel, META);
  assert.equal(result.floodStatus, "unknown");
  assert.notEqual(result.floodStatus, "outside");
  assert.equal(result.floodStatusReason, "no_tile");
  assert.equal(result.depthRank, null);
  assert.equal(result.assessmentCompleteness, "unavailable");
});

test("fetch_errorもunknownとして保持する（0や低リスク扱いにしない）", () => {
  const pixel: HazardPixelStatus = { status: "unknown", reason: "fetch_error" };
  const result = toStaticFloodHazardPointResult(POINT, pixel, META);
  assert.equal(result.floodStatus, "unknown");
  assert.equal(result.floodStatusReason, "fetch_error");
  assert.equal(result.depthRank, null);
});

test("color_unknownもunknownとして保持する", () => {
  const pixel: HazardPixelStatus = { status: "unknown", reason: "color_unknown" };
  const result = toStaticFloodHazardPointResult(POINT, pixel, META);
  assert.equal(result.floodStatus, "unknown");
  assert.equal(result.floodStatusReason, "color_unknown");
});

// PART G: 取得失敗地点も黙って削除せずunknownとして残す
test("ブラウザ側の取得失敗(例外)もunknownとして地点を残す(削除しない)", () => {
  const result = toCaptureFailurePointResult(POINT, META);
  assert.equal(result.floodStatus, "unknown");
  assert.equal(result.floodStatusReason, "browser_error");
  assert.equal(result.pointId, POINT.pointId);
  assert.equal(result.assessmentCompleteness, "unavailable");
});

// 5・6. depthRank・completeness保持の確認(不変条件)
test("hazard以外ではdepthRankが1以上にならない", () => {
  const outside = toStaticFloodHazardPointResult(POINT, { status: "outside" }, META);
  const unknown = toStaticFloodHazardPointResult(POINT, { status: "unknown", reason: "no_tile" }, META);
  assert.ok(outside.depthRank === 0);
  assert.ok(unknown.depthRank === null);
});

// 7. metadata/provenance保持
test("buildStaticFloodHazardDatasetはprovenance一式をmetadataへ保持する", () => {
  const points = [toStaticFloodHazardPointResult(POINT, { status: "hazard", rank: 1 }, META)];
  const dataset = buildStaticFloodHazardDataset(points, {
    generatedAt: "2026-09-08T00:00:00.000Z",
    systemVersion: "0.1.0",
    gitCommit: "abc1234",
    sourceURLPattern: "https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png",
  });
  assert.equal(dataset.metadata.generatedAt, "2026-09-08T00:00:00.000Z");
  assert.equal(dataset.metadata.systemVersion, "0.1.0");
  assert.equal(dataset.metadata.gitCommit, "abc1234");
  assert.ok(dataset.metadata.ruleVersion.length > 0);
  assert.ok(dataset.metadata.hazardDataSource.includes("洪水浸水想定区域"));
  assert.ok(dataset.metadata.generationMethod.includes("方式B"));
  assert.equal(dataset.points.length, 1);
});

// 12. 同一固定JSONから同一研究入力を再生成できる(純粋関数としての再現性)
test("同じ入力からは常に同じ構造のdatasetを再生成できる(再現性)", () => {
  const points = [toStaticFloodHazardPointResult(POINT, { status: "hazard", rank: 3 }, META)];
  const provenance = {
    generatedAt: "2026-09-08T00:00:00.000Z",
    systemVersion: "0.1.0",
    gitCommit: "abc1234",
    sourceURLPattern: "pattern",
  };
  const first = buildStaticFloodHazardDataset(points, provenance);
  const second = buildStaticFloodHazardDataset(points, provenance);
  assert.deepEqual(first, second);
});

// 11. unknown → insufficient_data(Backtestレポート表示用ラベル)
test("toBacktestHazardStatusLabel: unknownはinsufficient_dataとして表示される", () => {
  assert.equal(toBacktestHazardStatusLabel("unknown"), "insufficient_data");
  assert.equal(toBacktestHazardStatusLabel("hazard"), "hazard");
  assert.equal(toBacktestHazardStatusLabel("outside"), "outside");
});
