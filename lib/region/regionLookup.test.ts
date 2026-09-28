import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lookupRegion, type RegionBoundaryData } from "./regionLookup.ts";

// テストは実際にコミットされている境界データ(scripts/build-region-boundaries.mjs
// が生成したもの)をそのまま読み込む。モックではなく、実データでPoint in Polygonが
// 正しく動くことを確認する。
const municipalities = JSON.parse(
  readFileSync("data/region-boundaries/kinki-municipalities.geojson", "utf-8")
);
const bufferedPrefectures = JSON.parse(
  readFileSync("data/region-boundaries/kinki-prefectures-buffered.geojson", "utf-8")
);
const boundaries: RegionBoundaryData = { municipalities, bufferedPrefectures };

function expectSupported(lat: number, lng: number, prefectureCode: string, municipalityName?: string) {
  const result = lookupRegion(lat, lng, boundaries);
  assert.equal(result.status, "supported");
  if (result.status !== "supported") return; // for TypeScript narrowing
  assert.equal(result.region.prefectureCode, prefectureCode);
  if (municipalityName) {
    assert.equal(result.region.municipalityName, municipalityName);
  }
}

test("大阪市役所は大阪府・大阪市と判定される", () => {
  expectSupported(34.6937, 135.5023, "27", "大阪市");
});

test("大阪府堺市は大阪府・堺市と判定される（大阪市とは区別される）", () => {
  expectSupported(34.5733, 135.483, "27", "堺市");
});

test("京都府京都市は京都府・京都市と判定される", () => {
  expectSupported(35.0116, 135.7681, "26", "京都市");
});

test("兵庫県神戸市は兵庫県・神戸市と判定される", () => {
  expectSupported(34.6913, 135.183, "28", "神戸市");
});

test("滋賀県大津市は滋賀県・大津市と判定される", () => {
  expectSupported(35.0045, 135.8686, "25", "大津市");
});

test("奈良県奈良市は奈良県・奈良市と判定される", () => {
  expectSupported(34.6851, 135.8329, "29", "奈良市");
});

test("和歌山県和歌山市は和歌山県・和歌山市と判定される", () => {
  expectSupported(34.2261, 135.1675, "30", "和歌山市");
});

test("近畿外（東京都庁）はoutsideと判定される", () => {
  const result = lookupRegion(35.6895, 139.6917, boundaries);
  assert.equal(result.status, "outside");
});

test("近畿外（沖縄県庁）はoutsideと判定される", () => {
  const result = lookupRegion(26.2124, 127.6809, boundaries);
  assert.equal(result.status, "outside");
});

// 【重要】以下の境界付近の座標は、実際にコミットされている境界データから
// プログラム的に抽出した「2つの都道府県のバッファ（距離は
// regionBoundaryConfig.tsのREGION_BOUNDARY_AMBIGUITY_BUFFER_METERSで
// 一元管理）に同時に入る」
// 実在の頂点座標であり、目視で推測した座標ではない。単純矩形判定であれば
// どちらか一方に断定してしまうところを、正しくunknownとして扱えることを確認する。
const boundaryPoints: Array<[string, number, number]> = [
  ["大阪/京都", 34.9722, 135.6159],
  ["大阪/兵庫", 34.7331, 135.4603],
  ["大阪/奈良", 34.7825, 135.7127],
  ["京都/滋賀", 35.283, 135.8608],
  ["京都/兵庫", 35.3076, 134.9376],
  ["奈良/和歌山", 34.3795, 135.6514],
];

for (const [label, lat, lng] of boundaryPoints) {
  test(`${label}の境界付近はunknownと判定される（誤って一方の県だけに断定しない）`, () => {
    const result = lookupRegion(lat, lng, boundaries);
    assert.equal(result.status, "unknown");
  });
}

test("判定不能(unknown)は近畿外(outside)と混同されない（別のstatus値）", () => {
  const [, lat, lng] = boundaryPoints[0];
  const result = lookupRegion(lat, lng, boundaries);
  assert.notEqual(result.status, "outside");
});
