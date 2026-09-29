// Phase 6 PART A: deduplicateShelters()（保守的な重複名寄せ）の単体テスト。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deduplicateShelters, normalizeNameForDedup, EXACT_DUPLICATE_DISTANCE_METERS } from "./deduplicateShelters.ts";
import type { Shelter } from "./types.ts";

function makeShelter(overrides: Partial<Shelter>): Shelter {
  return {
    id: "id",
    name: "テスト施設",
    lat: 34.7,
    lng: 135.5,
    address: "テスト住所",
    prefectureCode: "27",
    municipalityCode: "27100",
    prefectureName: "大阪府",
    municipalityName: "大阪市",
    shelterType: "designated_emergency_evacuation_site",
    supportedDisasters: { flood: true },
    hazards: ["flood"],
    source: "テスト",
    telephone: null,
    availableHours: null,
    ward: null,
    category: null,
    ...overrides,
  };
}

test("同名＋同一座標＋ハザード一致 → 統合される", () => {
  const shelters = [
    makeShelter({ id: "a", lat: 34.7, lng: 135.5 }),
    makeShelter({ id: "b", lat: 34.7, lng: 135.5 }),
  ];
  const result = deduplicateShelters(shelters);
  assert.equal(result.shelters.length, 1);
  assert.equal(result.mergedClusterCount, 1);
  assert.equal(result.mergedRecordCount, 1);
  assert.deepEqual(result.shelters[0].mergedFrom, ["a", "b"]);
  assert.equal(result.flaggedPairs.length, 0);
});

test(`同名＋${EXACT_DUPLICATE_DISTANCE_METERS}m以内＋ハザード一致 → 統合される（座標の丸め誤差許容）`, () => {
  // 緯度0.00003度 ≒ 約3.3m（EXACT_DUPLICATE_DISTANCE_METERS=5未満）
  const shelters = [
    makeShelter({ id: "a", lat: 34.7, lng: 135.5 }),
    makeShelter({ id: "b", lat: 34.70003, lng: 135.5 }),
  ];
  const result = deduplicateShelters(shelters);
  assert.equal(result.shelters.length, 1, "5m未満の座標差は統合されるべき");
  assert.equal(result.mergedClusterCount, 1);
});

test("同名＋50m離れている → 自動統合しない（flaggedPairsに記録）", () => {
  // 緯度0.00045度 ≒ 約50m
  const shelters = [
    makeShelter({ id: "a", lat: 34.7, lng: 135.5 }),
    makeShelter({ id: "b", lat: 34.70045, lng: 135.5 }),
  ];
  const result = deduplicateShelters(shelters);
  assert.equal(result.shelters.length, 2, "50m離れている場合は別レコードのまま残るべき");
  assert.equal(result.mergedClusterCount, 0);
  assert.equal(result.flaggedPairs.length, 1);
  assert.equal(result.flaggedPairs[0].reason, "distance_exceeded");
});

test("別名＋同一座標 → 自動統合しない（名称が違えば別施設として扱う）", () => {
  const shelters = [
    makeShelter({ id: "a", name: "施設A", lat: 34.7, lng: 135.5 }),
    makeShelter({ id: "b", name: "施設B", lat: 34.7, lng: 135.5 }),
  ];
  const result = deduplicateShelters(shelters);
  assert.equal(result.shelters.length, 2);
  assert.equal(result.mergedClusterCount, 0);
  // 名称が異なるためグループ化自体されず、flaggedPairsにも入らない
  assert.equal(result.flaggedPairs.length, 0);
});

test("同名＋同一座標だがflood属性が矛盾（true/false） → 自動統合しない", () => {
  const shelters = [
    makeShelter({ id: "a", supportedDisasters: { flood: true } }),
    makeShelter({ id: "b", supportedDisasters: { flood: false } }),
  ];
  const result = deduplicateShelters(shelters);
  assert.equal(result.shelters.length, 2);
  assert.equal(result.mergedClusterCount, 0);
  assert.equal(result.flaggedPairs.length, 1);
  assert.equal(result.flaggedPairs[0].reason, "hazard_mismatch");
});

test("同名＋同一座標だがhazards配列が矛盾 → 自動統合しない", () => {
  const shelters = [
    makeShelter({ id: "a", hazards: ["flood", "earthquake"] }),
    makeShelter({ id: "b", hazards: ["flood"] }),
  ];
  const result = deduplicateShelters(shelters);
  assert.equal(result.shelters.length, 2);
  assert.equal(result.flaggedPairs.length, 1);
  assert.equal(result.flaggedPairs[0].reason, "hazard_mismatch");
});

test("hazards配列の順序違いは矛盾とみなさない（ソートして比較）", () => {
  const shelters = [
    makeShelter({ id: "a", hazards: ["flood", "earthquake"] }),
    makeShelter({ id: "b", hazards: ["earthquake", "flood"] }),
  ];
  const result = deduplicateShelters(shelters);
  assert.equal(result.shelters.length, 1);
});

test("同名＋同一座標でも異なるmunicipalityCode → 自動統合しない（別自治体扱い）", () => {
  const shelters = [
    makeShelter({ id: "a", municipalityCode: "27100" }),
    makeShelter({ id: "b", municipalityCode: "27140" }),
  ];
  const result = deduplicateShelters(shelters);
  assert.equal(result.shelters.length, 2);
});

test("同名＋同一座標でも異なるshelterType（指定緊急避難場所と指定避難所） → 自動統合しない", () => {
  const shelters = [
    makeShelter({ id: "a", shelterType: "designated_emergency_evacuation_site", supportedDisasters: { flood: true } }),
    makeShelter({ id: "b", shelterType: "designated_shelter", supportedDisasters: { flood: "unknown" }, hazards: [] }),
  ];
  const result = deduplicateShelters(shelters);
  assert.equal(result.shelters.length, 2, "指定緊急避難場所と指定避難所は\"both\"化せず別レコードのまま");
});

test("3件の同名＋同一座標クラスタ → 1件に統合され、mergedFromに全ID保持", () => {
  const shelters = [
    makeShelter({ id: "a", lat: 34.7, lng: 135.5 }),
    makeShelter({ id: "b", lat: 34.7, lng: 135.5 }),
    makeShelter({ id: "c", lat: 34.7, lng: 135.5 }),
  ];
  const result = deduplicateShelters(shelters);
  assert.equal(result.shelters.length, 1);
  assert.deepEqual(result.shelters[0].mergedFrom, ["a", "b", "c"]);
  assert.equal(result.mergedRecordCount, 2);
});

test("A棟・B棟・C棟のような近接だが別施設の可能性がある名称は、離れていれば統合しない", () => {
  // タイムズ・ピース・スクエア 立体駐車場A棟・B棟・C棟の実例（58.8m）を模した検証
  const shelters = [
    makeShelter({ id: "a", name: "立体駐車場Ａ棟・Ｂ棟・Ｃ棟", lat: 34.7, lng: 135.5 }),
    makeShelter({ id: "b", name: "立体駐車場Ａ棟・Ｂ棟・Ｃ棟", lat: 34.70053, lng: 135.5 }), // 約59m
  ];
  const result = deduplicateShelters(shelters);
  assert.equal(result.shelters.length, 2);
  assert.equal(result.flaggedPairs.length, 1);
});

test("単独レコード（重複なし）はそのまま1件で返り、mergedFromは付与されない", () => {
  const shelters = [makeShelter({ id: "a" })];
  const result = deduplicateShelters(shelters);
  assert.equal(result.shelters.length, 1);
  assert.equal(result.shelters[0].mergedFrom, undefined);
  assert.equal(result.mergedClusterCount, 0);
});

test("normalizeNameForDedup: 全角スペース・連続スペース・前後空白のみ正規化する", () => {
  assert.equal(normalizeNameForDedup("　施設名　"), "施設名");
  assert.equal(normalizeNameForDedup("施設  名"), "施設 名");
  assert.equal(normalizeNameForDedup("施設名"), "施設名");
  // 意味を推測する変換は行わない(「小学校」等はそのまま)
  assert.equal(normalizeNameForDedup("○○小学校"), "○○小学校");
});

test("120mを超える同名レコードはflaggedPairsにも含めない（無関係な別施設とみなす）", () => {
  // 緯度0.0013度 ≒ 約145m
  const shelters = [
    makeShelter({ id: "a", lat: 34.7, lng: 135.5 }),
    makeShelter({ id: "b", lat: 34.7013, lng: 135.5 }),
  ];
  const result = deduplicateShelters(shelters);
  assert.equal(result.shelters.length, 2);
  assert.equal(result.flaggedPairs.length, 0, "120m超は無関係な別施設とみなしflaggedPairsにも含めない");
});

// ---- Phase 6 PART A: 生成済みJSON（public/data/*.json）での回帰確認 ----
// 京都府「桃映中学校」・奈良県の同一名称・同一座標5件が、候補一覧で
// 二重表示されない（＝洪水対応の指定緊急避難場所として1件だけになる）こと。

function floodSitesNamed(slug: string, name: string): Shelter[] {
  const data = JSON.parse(readFileSync(`public/data/${slug}-prefecture-shelters.json`, "utf-8")) as { features: Shelter[] };
  return data.features.filter(
    (f) =>
      normalizeNameForDedup(f.name) === normalizeNameForDedup(name) &&
      f.shelterType === "designated_emergency_evacuation_site" &&
      f.supportedDisasters.flood === true
  );
}

for (const [slug, name] of [
  ["kyoto", "桃映中学校"],
  ["nara", "ならやま小学校"],
  ["nara", "登美ヶ丘公民館"],
  ["nara", "登美ヶ丘中学校"],
  ["nara", "東登美ヶ丘小学校"],
  ["nara", "東信貴ヶ丘自治会館"],
] as const) {
  test(`生成データ: ${name}（${slug}）は1件に統合され、統合元の2件のIDをmergedFromに保持する`, () => {
    const records = floodSitesNamed(slug, name);
    assert.equal(records.length, 1, `${name}が${records.length}件ある（二重表示の可能性）`);
    assert.equal(records[0].mergedFrom?.length, 2);
    assert.ok(records[0].mergedFrom?.includes(records[0].id));
  });
}

test("生成データ: 大阪市「市営放出西住宅６号館」（同名・約12m離れた2件）は、5mを超えるため自動統合されずに2件のまま", () => {
  const records = floodSitesNamed("osaka", "市営放出西住宅６号館");
  assert.equal(records.length, 2);
  assert.ok(records.every((r) => r.mergedFrom === undefined));
});

test("normalizeNameForDedup: 全角英数字と半角英数字の違い（NFKC）は同一視するが、表示名自体は変更しない", () => {
  assert.equal(normalizeNameForDedup("市営住宅６号館"), normalizeNameForDedup("市営住宅6号館"));
  assert.notEqual(normalizeNameForDedup("○○小学校"), normalizeNameForDedup("○○小"));
});
