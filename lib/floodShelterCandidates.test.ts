// Phase 3（地域拡張）: selectFloodCandidates()（純粋関数・ネットワークI/Oなし）の
// 単体テスト。洪水対応のflood: true/false/"unknown"の3状態が混同されないこと、
// 距離順ソート・poolSize制限が正しく動作することを検証する。
//
// getShelters()/findFloodShelterCandidates()自体はfetch()（ブラウザのURL解決に
// 依存）を使うため、ここではNode test環境から直接検証できるselectFloodCandidates()
// に対してテストする（既存のbuildRiskResult/assessRiskの分離と同じ設計思想）。
// 実際のfetch経由の動作はPlaywrightによる実機検証で確認している
// （完了報告参照）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { selectFloodCandidates, CANDIDATE_POOL_SIZE } from "./floodShelterCandidates.ts";
import type { Shelter } from "./shelter/types.ts";

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

const ORIGIN = { lat: 34.7, lng: 135.5 };

test("flood: trueの指定緊急避難場所のみ候補になる（false/unknownは混同されない）", () => {
  const shelters: Shelter[] = [
    makeShelter({ id: "a", supportedDisasters: { flood: true } }),
    makeShelter({ id: "b", supportedDisasters: { flood: false } }),
    makeShelter({ id: "c", supportedDisasters: { flood: "unknown" } }),
  ];
  const candidates = selectFloodCandidates(shelters, ORIGIN);
  assert.deepEqual(
    candidates.map((c) => c.id),
    ["a"]
  );
});

// 上のテストで3状態の混同がないことを確認済みだが、ユーザーからの明示的な
// 確認依頼（2026-09-29、コミット前の最終確認）に対応するため、
// true/false/unknownそれぞれの単独ケースも個別に明示する。
test("flood: true → 候補になる", () => {
  const shelters: Shelter[] = [makeShelter({ id: "a", supportedDisasters: { flood: true } })];
  const candidates = selectFloodCandidates(shelters, ORIGIN);
  assert.deepEqual(
    candidates.map((c) => c.id),
    ["a"]
  );
});

test("flood: false → 候補にならない", () => {
  const shelters: Shelter[] = [makeShelter({ id: "a", supportedDisasters: { flood: false } })];
  const candidates = selectFloodCandidates(shelters, ORIGIN);
  assert.deepEqual(candidates, []);
});

test('flood: "unknown" → 候補にならない', () => {
  const shelters: Shelter[] = [makeShelter({ id: "a", supportedDisasters: { flood: "unknown" } })];
  const candidates = selectFloodCandidates(shelters, ORIGIN);
  assert.deepEqual(candidates, []);
});

test('指定避難所2,988件相当（すべてflood: "unknown"）を大量に混ぜても、1件も候補に含まれない（「洪水対応」として扱わないことの確認）', () => {
  const manyUnknownShelters: Shelter[] = Array.from({ length: 2988 }, (_, i) =>
    makeShelter({
      id: `shelter-${i}`,
      shelterType: "designated_shelter",
      supportedDisasters: { flood: "unknown" },
      hazards: [],
      lat: 34.7 + (i % 50) * 0.001,
      lng: 135.5 + (i % 50) * 0.001,
    })
  );
  const oneTrueSite = makeShelter({ id: "the-only-flood-true", supportedDisasters: { flood: true } });
  const candidates = selectFloodCandidates([...manyUnknownShelters, oneTrueSite], ORIGIN, 9999);
  assert.deepEqual(
    candidates.map((c) => c.id),
    ["the-only-flood-true"]
  );
});

test("shelterType===designated_shelter（指定避難所）は、flood:trueであっても候補にならない", () => {
  // 指定避難所には災害種別の列が存在しないため、supportedDisasters.floodは
  // 通常常にunknownだが、万一trueが入っていても指定緊急避難場所以外は対象外。
  const shelters: Shelter[] = [
    makeShelter({ id: "shelter1", shelterType: "designated_shelter", supportedDisasters: { flood: true } }),
    makeShelter({ id: "site1", shelterType: "designated_emergency_evacuation_site", supportedDisasters: { flood: true } }),
  ];
  const candidates = selectFloodCandidates(shelters, ORIGIN);
  assert.deepEqual(
    candidates.map((c) => c.id),
    ["site1"]
  );
});

test("現在地から近い順にソートされる（市町村をまたいでも距離だけで並ぶ）", () => {
  const shelters: Shelter[] = [
    makeShelter({ id: "far", lat: 34.8, lng: 135.6, municipalityCode: "27203", municipalityName: "豊中市" }),
    makeShelter({ id: "near", lat: 34.701, lng: 135.501, municipalityCode: "27100", municipalityName: "大阪市" }),
    makeShelter({ id: "middle", lat: 34.72, lng: 135.52, municipalityCode: "27140", municipalityName: "堺市" }),
  ];
  const candidates = selectFloodCandidates(shelters, ORIGIN);
  assert.deepEqual(
    candidates.map((c) => c.id),
    ["near", "middle", "far"]
  );
});

test("poolSizeを超える候補は切り捨てられる（既定値CANDIDATE_POOL_SIZE）", () => {
  const shelters: Shelter[] = Array.from({ length: CANDIDATE_POOL_SIZE + 3 }, (_, i) =>
    makeShelter({ id: `s${i}`, lat: 34.7 + i * 0.001, lng: 135.5 })
  );
  const candidates = selectFloodCandidates(shelters, ORIGIN);
  assert.equal(candidates.length, CANDIDATE_POOL_SIZE);
});

test("poolSizeを明示指定すればその件数までになる", () => {
  const shelters: Shelter[] = Array.from({ length: 10 }, (_, i) =>
    makeShelter({ id: `s${i}`, lat: 34.7 + i * 0.001, lng: 135.5 })
  );
  const candidates = selectFloodCandidates(shelters, ORIGIN, 2);
  assert.equal(candidates.length, 2);
});

test("候補が0件の場合は空配列を返す（例外にしない）", () => {
  const shelters: Shelter[] = [makeShelter({ id: "a", supportedDisasters: { flood: false } })];
  const candidates = selectFloodCandidates(shelters, ORIGIN);
  assert.deepEqual(candidates, []);
});
