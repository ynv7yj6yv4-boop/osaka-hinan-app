import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lookupRegion, type RegionBoundaryData } from "./regionLookup.ts";
import type { PrefectureCode } from "./types.ts";

// テストは実際にコミットされている境界データ(scripts/build-region-boundaries.mjs
// が生成したもの)をそのまま読み込む。モックではなく、実データでPoint in Polygonが
// 正しく動くことを確認する。
const municipalities = JSON.parse(
  readFileSync("data/region-boundaries/kinki-municipalities.geojson", "utf-8")
);
const bufferedPrefectures = JSON.parse(
  readFileSync("data/region-boundaries/kinki-prefectures-buffered.geojson", "utf-8")
);
const crossSearchBufferedPrefectures = JSON.parse(
  readFileSync("data/region-boundaries/kinki-prefectures-buffered-cross-search.geojson", "utf-8")
);
const boundaries: RegionBoundaryData = { municipalities, bufferedPrefectures, crossSearchBufferedPrefectures };

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
// Phase 6 PART B: 大阪/和歌山の境界点を追加し、item 16で要求された7境界
// （大阪/京都・大阪/兵庫・大阪/奈良・大阪/和歌山・京都/滋賀・京都/兵庫・
// 奈良/和歌山）すべてを網羅した。
const boundaryPoints: Array<[string, number, number, [string, string]]> = [
  ["大阪/京都", 34.9722, 135.6159, ["27", "26"]],
  ["大阪/兵庫", 34.7331, 135.4603, ["27", "28"]],
  ["大阪/奈良", 34.7825, 135.7127, ["27", "29"]],
  ["大阪/和歌山", 34.3339, 135.5084, ["27", "30"]],
  ["京都/滋賀", 35.283, 135.8608, ["26", "25"]],
  ["京都/兵庫", 35.3076, 134.9376, ["26", "28"]],
  ["奈良/和歌山", 34.3795, 135.6514, ["29", "30"]],
];

for (const [label, lat, lng, expectedCodes] of boundaryPoints) {
  test(`${label}の境界付近はunknownと判定される（誤って一方の県だけに断定しない）`, () => {
    const result = lookupRegion(lat, lng, boundaries);
    assert.equal(result.status, "unknown");
  });

  test(`${label}の境界付近はreason:"boundary_ambiguity"とcandidatePrefectureCodesを伴う（Phase 6 PART B）`, () => {
    const result = lookupRegion(lat, lng, boundaries);
    assert.equal(result.status, "unknown");
    if (result.status !== "unknown") return;
    assert.equal(result.reason, "boundary_ambiguity");
    assert.ok(result.candidatePrefectureCodes);
    const sorted = [...result.candidatePrefectureCodes].sort();
    assert.deepEqual(sorted, [...expectedCodes].sort());
  });
}

test("判定不能(unknown)は近畿外(outside)と混同されない（別のstatus値）", () => {
  const [, lat, lng] = boundaryPoints[0];
  const result = lookupRegion(lat, lng, boundaries);
  assert.notEqual(result.status, "outside");
});

// Phase 6 PART B: nearbyPrefectureCodes（府県境検索のトリガー判定用）。
test("府県境から遠い地点（大阪市役所）はnearbyPrefectureCodesが空配列", () => {
  const result = lookupRegion(34.6937, 135.5023, boundaries);
  assert.equal(result.status, "supported");
  if (result.status !== "supported") return;
  assert.deepEqual(result.region.nearbyPrefectureCodes, []);
});

test("府県境の近く（高槻市、京都府境から3km以内・実在の境界頂点から抽出）は、supportedのまま(判定は断定)、nearbyPrefectureCodesに隣接府県コードを含む", () => {
  const result = lookupRegion(34.913, 135.5764, boundaries);
  assert.equal(result.status, "supported");
  if (result.status !== "supported") return;
  assert.equal(result.region.prefectureCode, "27");
  assert.equal(result.region.municipalityName, "高槻市");
  assert.deepEqual(result.region.nearbyPrefectureCodes, ["26"]);
});

// Phase 6 PART B（item 16）: 府県境からの距離別テスト。
// 各地点は目視推測ではなく、既存のN03境界データ（kinki-municipalities.geojson）の
// 隣接府県ポリゴン境界線までの距離を@turf/point-to-line-distanceで測りながら、
// 上記boundaryPointsの境界頂点から府県内側へ移動して求めた（Phase 6実施時）。
// 「near」は約500m・約2km（CROSS_PREFECTURE_SEARCH_DISTANCE_METERS=3km以内）、
// 「far」は約6km（3kmを十分超える）の地点。
type BorderDistanceCase = {
  label: string;
  inPrefecture: PrefectureCode;
  neighbor: PrefectureCode;
  near500m: [number, number];
  near2km: [number, number];
  far6km: [number, number];
};
const borderDistanceCases: BorderDistanceCase[] = [
  // 大阪/京都の500m地点は京都府側（京都市）。境界が入り組んでおり、境界頂点から
  // 大阪府側へ500mの地点がとれなかったため、同じ境界の反対側で確認する。
  { label: "大阪/京都", inPrefecture: "27", neighbor: "26", near500m: [34.93762, 135.6159], near2km: [34.90932, 135.6159], far6km: [34.86, 135.6159] },
  { label: "大阪/兵庫", inPrefecture: "27", neighbor: "28", near500m: [34.73063, 135.46551], near2km: [34.72389, 135.47971], far6km: [34.70593, 135.51757] },
  { label: "大阪/奈良", inPrefecture: "27", neighbor: "29", near500m: [34.786, 135.71024], near2km: [34.79767, 135.70204], far6km: [34.82879, 135.68016] },
  { label: "大阪/和歌山", inPrefecture: "27", neighbor: "30", near500m: [34.34872, 135.5084], near2km: [34.36804, 135.5084], far6km: [34.4134, 135.5084] },
  { label: "京都/滋賀", inPrefecture: "26", neighbor: "25", near500m: [35.27498, 135.82413], near2km: [35.27126, 135.80712], far6km: [35.26173, 135.76354] },
  { label: "京都/兵庫", inPrefecture: "26", neighbor: "28", near500m: [35.31209, 134.94713], near2km: [35.31928, 134.96239], far6km: [35.3076, 135.19] },
  { label: "奈良/和歌山", inPrefecture: "29", neighbor: "30", near500m: [34.38078, 135.65718], near2km: [34.38427, 135.67295], far6km: [34.39368, 135.71553] },
];

for (const c of borderDistanceCases) {
  for (const [distanceLabel, [lat, lng]] of [
    ["約500m", c.near500m],
    ["約2km", c.near2km],
  ] as const) {
    test(`${c.label}: 府県境から${distanceLabel}の地点は、府県を断定しつつ（supported）隣接府県を検索対象に含める`, () => {
      const result = lookupRegion(lat, lng, boundaries);
      assert.equal(result.status, "supported");
      if (result.status !== "supported") return;
      // 大阪/京都の500m地点のみ京都府側（上記コメント参照）
      const [expectedPref, expectedNeighbor] =
        c.label === "大阪/京都" && distanceLabel === "約500m" ? [c.neighbor, c.inPrefecture] : [c.inPrefecture, c.neighbor];
      assert.equal(result.region.prefectureCode, expectedPref);
      assert.ok(
        result.region.nearbyPrefectureCodes.includes(expectedNeighbor),
        `nearbyPrefectureCodesに${expectedNeighbor}が含まれていない: ${JSON.stringify(result.region.nearbyPrefectureCodes)}`
      );
    });
  }

  test(`${c.label}: 府県境から約6km離れた地点は、その隣接府県を検索対象に含めない`, () => {
    const [lat, lng] = c.far6km;
    const result = lookupRegion(lat, lng, boundaries);
    assert.equal(result.status, "supported");
    if (result.status !== "supported") return;
    assert.equal(result.region.prefectureCode, c.inPrefecture);
    assert.ok(
      !result.region.nearbyPrefectureCodes.includes(c.neighbor),
      `3kmを超えて離れているのにnearbyPrefectureCodesに${c.neighbor}が含まれている`
    );
  });
}

test("nearbyPrefectureCodesは実際に隣接する府県だけを含む（滋賀県と大阪府は隣接しないため、大津市で大阪府は入らない）", () => {
  const result = lookupRegion(35.0045, 135.8686, boundaries); // 大津市役所（京都府境から約2.3km）
  assert.equal(result.status, "supported");
  if (result.status !== "supported") return;
  assert.deepEqual(result.region.nearbyPrefectureCodes, ["26"]);
});

test("近畿外（三重県津市・愛知県名古屋市・東京都庁）はoutsideと判定される", () => {
  for (const [lat, lng] of [
    [34.7303, 136.5086],
    [35.1815, 136.9066],
    [35.6895, 139.6917],
  ]) {
    assert.equal(lookupRegion(lat, lng, boundaries).status, "outside");
  }
});
