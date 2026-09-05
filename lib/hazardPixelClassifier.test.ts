// Phase 5A.3: 共通ハザード判定ロジックの回帰テスト。
// ネットワーク不要（TileSampleResultを直接与えて interpretTileSample を検証する）。
//
// 実行方法: npm test （または node --test lib/hazardPixelClassifier.test.ts）

import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretTileSample } from "./hazardPixelClassifier.ts";
import type { TileSampleResult } from "./tilePixel.ts";

// A. 明確な洪水着色区域（想定浸水深0.5〜3.0mの色 = 国交省標準凡例）
test("A. 明確な着色区域 → hazard（ランク付き）", () => {
  const result: TileSampleResult = { kind: "pixel", r: 255, g: 216, b: 192, a: 255 };
  const status = interpretTileSample(result);
  assert.equal(status.status, "hazard");
  if (status.status === "hazard") {
    assert.equal(status.rank, 2);
  }
});

// B. 正常なタイル内の区域外地点（タイルは存在するが、その地点は透明＝着色なし）
test("B. タイルは存在するが透明ピクセル → outside", () => {
  const result: TileSampleResult = { kind: "pixel", r: 0, g: 0, b: 0, a: 0 };
  const status = interpretTileSample(result);
  assert.equal(status.status, "outside");
});

// C. 404（タイル自体が存在しない）
test("C. タイルが存在しない(404) → unknown/no_tile", () => {
  const result: TileSampleResult = { kind: "no_tile" };
  const status = interpretTileSample(result);
  assert.equal(status.status, "unknown");
  if (status.status === "unknown") {
    assert.equal(status.reason, "no_tile");
  }
});

// D. 通信・取得エラー
test("D. 通信エラー等 → unknown/fetch_error", () => {
  const result: TileSampleResult = { kind: "error" };
  const status = interpretTileSample(result);
  assert.equal(status.status, "unknown");
  if (status.status === "unknown") {
    assert.equal(status.reason, "fetch_error");
  }
});

// E. 未知の色（凡例のどれとも一致しない、想定外の色）
test("E. 凡例と一致しない色 → unknown/color_unknown", () => {
  const result: TileSampleResult = { kind: "pixel", r: 10, g: 200, b: 10, a: 255 }; // 鮮やかな緑（凡例にない）
  const status = interpretTileSample(result);
  assert.equal(status.status, "unknown");
  if (status.status === "unknown") {
    assert.equal(status.reason, "color_unknown");
  }
});

test("重要な不変条件: 404は絶対にhazardにもoutsideにもならない（安全側への断定禁止）", () => {
  const result: TileSampleResult = { kind: "no_tile" };
  const status = interpretTileSample(result);
  assert.notEqual(status.status, "hazard");
  assert.notEqual(status.status, "outside");
});
