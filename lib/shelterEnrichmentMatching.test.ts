// lib/shelterEnrichmentMatching.ts の単体テスト。
// 実データ(大阪市1528件・GSI4083件)での検証結果(マッチ成功1471・未マッチ37・
// あいまい20、MATCH_MAX_DISTANCE_METERS=120m)を踏まえた、代表的なケースを
// 小さな合成データで検証する。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchShelterEnrichment,
  normalizeNameForMatching,
  normalizeOptionalText,
  namesMatch,
  haversineDistanceMeters,
  type MatchableGsiFeature,
  type CityShelterRecord,
} from "./shelterEnrichmentMatching.ts";

// 大阪市役所付近を基準に、緯度1度≒111km換算でおおよそのオフセットを作る簡易ヘルパー。
function offsetMeters(base: { lat: number; lng: number }, north: number, east: number) {
  return {
    lat: base.lat + north / 111000,
    lng: base.lng + east / (111000 * Math.cos((base.lat * Math.PI) / 180)),
  };
}

const BASE = { lat: 34.6937, lng: 135.5023 };

function cityRecord(overrides: Partial<CityShelterRecord>): CityShelterRecord {
  return {
    name: "テスト小学校",
    lat: BASE.lat,
    lng: BASE.lng,
    telephone: null,
    availableHours: null,
    ward: null,
    category: null,
    ...overrides,
  };
}

// --- 正常なマッチ ---

test("座標が近く施設名が一致すれば、電話番号・避難可能時間等が補完される", () => {
  const gsi: MatchableGsiFeature[] = [{ id: "G1", name: "テスト小学校", ...BASE }];
  const city: CityShelterRecord[] = [
    cityRecord({ telephone: "6613-0160", availableHours: "24時間", ward: "住之江区", category: "一時避難場所" }),
  ];

  const { enrichmentByGsiId, report } = matchShelterEnrichment(gsi, city);

  assert.equal(report.matchedCount, 1);
  assert.equal(report.unmatchedCount, 0);
  assert.equal(report.ambiguousCount, 0);
  assert.deepEqual(enrichmentByGsiId.get("G1"), {
    telephone: "6613-0160",
    availableHours: "24時間",
    ward: "住之江区",
    category: "一時避難場所",
  });
});

test("施設名の全角/半角・空白・「（運動場）」付記の違いがあってもマッチする(名寄せ)", () => {
  const gsi: MatchableGsiFeature[] = [{ id: "G1", name: "南港桜小学校（運動場）", ...BASE }];
  const city: CityShelterRecord[] = [cityRecord({ name: "南港桜小学校", telephone: "6613-0160" })];

  const { enrichmentByGsiId, report } = matchShelterEnrichment(gsi, city);

  assert.equal(report.matchedCount, 1);
  assert.equal(enrichmentByGsiId.get("G1")?.telephone, "6613-0160");
});

test("同一施設への重複登録(指定緊急避難場所＋指定避難所)は、正規化名が同じであれば両方へ安全に補完する", () => {
  const gsi: MatchableGsiFeature[] = [
    { id: "G1", name: "南港桜小学校", ...BASE },
    { id: "G2", name: "南港桜小学校（運動場）", ...BASE },
  ];
  const city: CityShelterRecord[] = [cityRecord({ name: "南港桜小学校", telephone: "6613-0160" })];

  const { enrichmentByGsiId, report } = matchShelterEnrichment(gsi, city);

  assert.equal(report.matchedCount, 1);
  assert.equal(report.multiCandidateCount, 1);
  assert.equal(report.ambiguousCount, 0);
  assert.equal(enrichmentByGsiId.get("G1")?.telephone, "6613-0160");
  assert.equal(enrichmentByGsiId.get("G2")?.telephone, "6613-0160");
});

// --- 未マッチ ---

test("座標が離れている(120mを超える)場合はマッチせず、補完しない", () => {
  const far = offsetMeters(BASE, 300, 0); // 約300m北
  const gsi: MatchableGsiFeature[] = [{ id: "G1", name: "テスト小学校", ...far }];
  const city: CityShelterRecord[] = [cityRecord({ telephone: "6613-0160" })];

  const { enrichmentByGsiId, report } = matchShelterEnrichment(gsi, city);

  assert.equal(report.matchedCount, 0);
  assert.equal(report.unmatchedCount, 1);
  assert.equal(enrichmentByGsiId.size, 0);
});

test("座標が近くても施設名が一致しなければマッチせず、補完しない", () => {
  const gsi: MatchableGsiFeature[] = [{ id: "G1", name: "全く別の公園", ...BASE }];
  const city: CityShelterRecord[] = [cityRecord({ name: "テスト小学校", telephone: "6613-0160" })];

  const { enrichmentByGsiId, report } = matchShelterEnrichment(gsi, city);

  assert.equal(report.matchedCount, 0);
  assert.equal(report.unmatchedCount, 1);
  assert.equal(enrichmentByGsiId.size, 0);
});

// --- あいまいなマッチ(安全側で補完しない) ---

test("正規化名が食い違う複数候補がある場合はあいまい判定とし、誤った紐付けを避けるため補完しない", () => {
  // 「中開公園」「開公園」のように、一方が他方の部分文字列になっている
  // 別施設が近接しているケース(実データでも確認済み)。
  const gsi: MatchableGsiFeature[] = [
    { id: "G1", name: "中開公園", ...BASE },
    { id: "G2", name: "開公園", ...offsetMeters(BASE, 10, 10) },
  ];
  const city: CityShelterRecord[] = [cityRecord({ name: "中開公園", telephone: "6613-0160" })];

  const { enrichmentByGsiId, report } = matchShelterEnrichment(gsi, city);

  assert.equal(report.matchedCount, 0);
  assert.equal(report.ambiguousCount, 1);
  assert.equal(enrichmentByGsiId.size, 0, "あいまいな場合はどちらのGSI地点にも補完しない");
});

// --- 電話番号なし・利用可能時間なし ---

test("電話番号が「－」等の場合はnullとして扱い、架空の番号を生成しない", () => {
  const gsi: MatchableGsiFeature[] = [{ id: "G1", name: "テスト小学校", ...BASE }];
  const city: CityShelterRecord[] = [cityRecord({ telephone: "－", availableHours: "24時間" })];

  const { enrichmentByGsiId } = matchShelterEnrichment(gsi, city);

  assert.equal(enrichmentByGsiId.get("G1")?.telephone, null);
  assert.equal(enrichmentByGsiId.get("G1")?.availableHours, "24時間");
});

test("避難可能時間が空欄・各種ダッシュ表記の場合もnullとして扱う", () => {
  const gsi: MatchableGsiFeature[] = [{ id: "G1", name: "テスト小学校", ...BASE }];
  for (const emptyValue of ["", "-", "‐", "―", "－"]) {
    const city: CityShelterRecord[] = [cityRecord({ availableHours: emptyValue })];
    const { enrichmentByGsiId } = matchShelterEnrichment(gsi, city);
    assert.equal(enrichmentByGsiId.get("G1")?.availableHours, null, `"${emptyValue}" はnull扱いになるはず`);
  }
});

// --- 純粋関数の単体テスト ---

test("normalizeOptionalText: 各種ダッシュ表記・空文字をnullにする", () => {
  for (const v of ["", "－", "-", "‐", "―", "  "]) {
    assert.equal(normalizeOptionalText(v), null);
  }
  assert.equal(normalizeOptionalText("6613-0160"), "6613-0160");
});

test("normalizeNameForMatching: 括弧内の付記・空白を除去する", () => {
  assert.equal(normalizeNameForMatching("南港桜小学校（運動場）"), "南港桜小学校");
  assert.equal(normalizeNameForMatching(" 南港 桜 小学校 "), "南港桜小学校");
});

test("namesMatch: 完全一致または包含関係のみtrue", () => {
  assert.equal(namesMatch("南港桜小学校", "南港桜小学校"), true);
  assert.equal(namesMatch("大阪府立港南造形高等学校", "港南造形高等学校"), true);
  assert.equal(namesMatch("中開公園", "開公園"), true); // 包含関係自体はtrue(あいまい判定は上位のロジック側の責務)
  assert.equal(namesMatch("南港桜小学校", "南港北中学校"), false);
  assert.equal(namesMatch("", "南港桜小学校"), false);
});

test("haversineDistanceMeters: 同一地点は0、既知のおおよその距離感を保つ", () => {
  assert.equal(haversineDistanceMeters(BASE, BASE), 0);
  const near = offsetMeters(BASE, 100, 0);
  const d = haversineDistanceMeters(BASE, near);
  assert.ok(d > 90 && d < 110, `expected ~100m, got ${d}`);
});
