// Phase 6 PART B: 府県境を越えた避難先候補検索のテスト。
//
// 1. getShelterSearchScope(): 地域判定結果から検索対象府県を決める部分
// 2. findFloodShelterCandidates(): 取得関数（ShelterFetcher）を差し替え、
//    「どの府県のProviderが呼ばれたか（不要な府県をロードしないか）」と
//    取得失敗時の安全側の扱いを確認する
// 3. 実データ（public/data/*.json・境界データ）: 府県境付近で実際に
//    隣接府県の避難先が候補に選ばれることを確認する

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getShelterSearchScope } from "./crossPrefectureSearch.ts";
import { findFloodShelterCandidates, type ShelterFetcher } from "../floodShelterCandidates.ts";
import { lookupRegion, type RegionBoundaryData } from "../region/regionLookup.ts";
import type { PrefectureCode, RegionCheckResult } from "../region/types.ts";
import { PREFECTURE_SLUGS } from "../region/types.ts";
import type { Shelter } from "./types.ts";

function supported(prefectureCode: PrefectureCode, nearbyPrefectureCodes: PrefectureCode[]): RegionCheckResult {
  return { status: "supported", region: { prefectureCode, prefectureName: "", nearbyPrefectureCodes } };
}

// ---- 1. getShelterSearchScope ----

test("府県境から離れた地点（nearbyなし）は現在府県のみを検索対象にする", () => {
  const scope = getShelterSearchScope(supported("27", []));
  assert.deepEqual(scope, { prefectureCodes: ["27"], primaryPrefectureCode: "27", reason: "current_prefecture_only" });
});

test("府県境付近（nearbyあり）は現在府県＋隣接府県を検索対象にし、現在府県を先頭にする", () => {
  const scope = getShelterSearchScope(supported("27", ["29", "26"]));
  assert.deepEqual(scope, {
    prefectureCodes: ["27", "29", "26"],
    primaryPrefectureCode: "27",
    reason: "near_prefecture_boundary",
  });
});

test("boundary_ambiguity（unknown）では、unknownのまま候補府県すべてを検索対象にする（現在府県は確定させない）", () => {
  const regionCheck: RegionCheckResult = {
    status: "unknown",
    reason: "boundary_ambiguity",
    candidatePrefectureCodes: ["27", "29"],
  };
  const scope = getShelterSearchScope(regionCheck);
  assert.deepEqual(scope, { prefectureCodes: ["27", "29"], primaryPrefectureCode: null, reason: "boundary_ambiguity" });
  // 地域判定結果そのものはunknownのまま（supportedへ書き換えない）
  assert.equal(regionCheck.status, "unknown");
});

test("理由の無いunknown・error・outside・未判定(null)では検索しない", () => {
  assert.equal(getShelterSearchScope({ status: "unknown" }), null);
  assert.equal(getShelterSearchScope({ status: "error", message: "x" }), null);
  assert.equal(getShelterSearchScope({ status: "outside" }), null);
  assert.equal(getShelterSearchScope(null), null);
});

test("近畿2府4県の外の府県コードは、隣接府県・候補府県として渡されても検索対象にしない", () => {
  const scope = getShelterSearchScope(supported("29", ["24" as PrefectureCode, "30"]));
  assert.deepEqual(scope?.prefectureCodes, ["29", "30"]);
  const ambiguous = getShelterSearchScope({
    status: "unknown",
    reason: "boundary_ambiguity",
    candidatePrefectureCodes: ["24" as PrefectureCode],
  });
  assert.equal(ambiguous, null);
});

// ---- 2. findFloodShelterCandidates（取得関数を差し替え） ----

function floodSite(id: string, prefectureCode: PrefectureCode, lat: number, lng: number): Shelter {
  return {
    id,
    name: id,
    lat,
    lng,
    prefectureCode,
    municipalityCode: `${prefectureCode}201`,
    prefectureName: `pref${prefectureCode}`,
    municipalityName: `muni${prefectureCode}`,
    shelterType: "designated_emergency_evacuation_site",
    supportedDisasters: { flood: true },
    hazards: ["flood"],
    source: "test",
  };
}

const ORIGIN = { lat: 34.7, lng: 135.5 };

function recordingFetcher(data: Partial<Record<PrefectureCode, Shelter[] | "error">>) {
  const called: PrefectureCode[] = [];
  const fetcher: ShelterFetcher = async (code) => {
    called.push(code);
    const d = data[code];
    if (d === undefined) return { status: "unsupported" };
    if (d === "error") return { status: "fetch_error" };
    return { status: "ok", shelters: d };
  };
  return { fetcher, called };
}

test("府県境から離れていれば、現在府県のProviderだけを呼ぶ（隣接府県のJSONを取得しない）", async () => {
  const { fetcher, called } = recordingFetcher({ "27": [floodSite("a", "27", 34.701, 135.5)], "28": [] });
  const scope = getShelterSearchScope(supported("27", []))!;
  const result = await findFloodShelterCandidates(ORIGIN, scope, 5, fetcher);
  assert.equal(result.status, "ok");
  assert.deepEqual(called, ["27"]);
});

test("府県境付近では、隣接府県のProviderを検索対象府県の分だけ呼び、それ以外の府県は呼ばない", async () => {
  const { fetcher, called } = recordingFetcher({ "27": [], "28": [], "29": [], "26": [], "30": [], "25": [] });
  const scope = getShelterSearchScope(supported("27", ["28"]))!;
  await findFloodShelterCandidates(ORIGIN, scope, 5, fetcher);
  assert.deepEqual([...called].sort(), ["27", "28"]);
});

test("府県が違っても距離順で共通にランキングする（隣接府県の候補にペナルティを付けない）", async () => {
  const { fetcher } = recordingFetcher({
    "27": [floodSite("osaka-far", "27", 34.72, 135.5)], // 約2.2km
    "28": [floodSite("hyogo-near", "28", 34.701, 135.5)], // 約110m
  });
  const scope = getShelterSearchScope(supported("27", ["28"]))!;
  const result = await findFloodShelterCandidates(ORIGIN, scope, 5, fetcher);
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.deepEqual(
    result.candidates.map((c) => c.id),
    ["hyogo-near", "osaka-far"]
  );
  assert.equal(result.candidates[0].prefectureCode, "28");
  assert.equal(result.candidates[0].prefectureName, "pref28");
});

test("隣接府県の取得だけが失敗した場合は、現在府県の候補を表示しつつ失敗した府県を返す", async () => {
  const { fetcher } = recordingFetcher({ "27": [floodSite("a", "27", 34.701, 135.5)], "29": "error" });
  const scope = getShelterSearchScope(supported("27", ["29"]))!;
  const result = await findFloodShelterCandidates(ORIGIN, scope, 5, fetcher);
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.deepEqual(result.failedPrefectureCodes, ["29"]);
  assert.deepEqual(result.searchedPrefectureCodes, ["27"]);
  assert.equal(result.candidates.length, 1);
});

test("現在府県の取得が失敗した場合は、隣接府県の候補だけを「近い順」として見せずfetch_errorにする", async () => {
  const { fetcher } = recordingFetcher({ "27": "error", "28": [floodSite("b", "28", 34.701, 135.5)] });
  const scope = getShelterSearchScope(supported("27", ["28"]))!;
  const result = await findFloodShelterCandidates(ORIGIN, scope, 5, fetcher);
  assert.equal(result.status, "fetch_error");
});

test("boundary_ambiguityでいずれかの府県の取得に失敗した場合はfetch_error（片方だけの候補を見せない）", async () => {
  const { fetcher } = recordingFetcher({ "27": [floodSite("a", "27", 34.701, 135.5)], "29": "error" });
  const scope = getShelterSearchScope({ status: "unknown", reason: "boundary_ambiguity", candidatePrefectureCodes: ["27", "29"] })!;
  const result = await findFloodShelterCandidates(ORIGIN, scope, 5, fetcher);
  assert.equal(result.status, "fetch_error");
});

test("boundary_ambiguityで両府県とも取得できれば、両府県の候補を距離順に合わせて返す", async () => {
  const { fetcher, called } = recordingFetcher({
    "27": [floodSite("osaka", "27", 34.702, 135.5)],
    "29": [floodSite("nara", "29", 34.701, 135.5)],
  });
  const scope = getShelterSearchScope({ status: "unknown", reason: "boundary_ambiguity", candidatePrefectureCodes: ["27", "29"] })!;
  const result = await findFloodShelterCandidates(ORIGIN, scope, 5, fetcher);
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.deepEqual([...called].sort(), ["27", "29"]);
  assert.deepEqual(
    result.candidates.map((c) => c.id),
    ["nara", "osaka"]
  );
});

// ---- 3. 実データでの確認 ----

const readJson = (p: string) => JSON.parse(readFileSync(p, "utf-8"));
const boundaries: RegionBoundaryData = {
  municipalities: readJson("data/region-boundaries/kinki-municipalities.geojson"),
  bufferedPrefectures: readJson("data/region-boundaries/kinki-prefectures-buffered.geojson"),
  crossSearchBufferedPrefectures: readJson("data/region-boundaries/kinki-prefectures-buffered-cross-search.geojson"),
};
const diskFetcher: ShelterFetcher = async (code) => ({
  status: "ok",
  shelters: readJson(`public/data/${PREFECTURE_SLUGS[code]}-prefecture-shelters.json`).features,
});

test("実データ: 大阪/和歌山の府県境（河内長野市側、境界から約500m）では、和歌山県の避難先が最も近い候補として選ばれる", async () => {
  const position = { lat: 34.34872, lng: 135.5084 };
  const regionCheck = lookupRegion(position.lat, position.lng, boundaries);
  const scope = getShelterSearchScope(regionCheck);
  assert.ok(scope);
  assert.equal(scope.primaryPrefectureCode, "27");
  assert.deepEqual(scope.prefectureCodes, ["27", "30"]);
  const result = await findFloodShelterCandidates(position, scope, 5, diskFetcher);
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  // Phase 6実施時の結果: 1位は和歌山県かつらぎ町「東谷ふるさとセンター」（約2.0km）。
  // 大阪府内で最も近い洪水対応の指定緊急避難場所（約2.7km）より近い。
  assert.equal(result.candidates[0].prefectureCode, "30");
  assert.equal(result.candidates[0].municipalityName, "かつらぎ町");
});

test("実データ: 大阪/奈良の府県境（交野市側、境界から約500m）では、奈良県生駒市の避難先も候補に含まれる", async () => {
  const position = { lat: 34.786, lng: 135.71024 };
  const scope = getShelterSearchScope(lookupRegion(position.lat, position.lng, boundaries));
  assert.ok(scope);
  const result = await findFloodShelterCandidates(position, scope, 5, diskFetcher);
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.ok(result.candidates.some((c) => c.prefectureCode === "29" && c.municipalityName === "生駒市"));
});

test("実データ: 大阪/奈良の境界バッファ内（unknown）でも、大阪府・奈良県の両方から候補を検索できる", async () => {
  const position = { lat: 34.7825, lng: 135.7127 };
  const regionCheck = lookupRegion(position.lat, position.lng, boundaries);
  assert.equal(regionCheck.status, "unknown");
  const scope = getShelterSearchScope(regionCheck);
  assert.ok(scope);
  assert.equal(scope.reason, "boundary_ambiguity");
  const result = await findFloodShelterCandidates(position, scope, 5, diskFetcher);
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  const prefs = new Set(result.candidates.map((c) => c.prefectureCode));
  assert.ok(prefs.has("27") && prefs.has("29"));
});

test("実データ: 府県境から離れた大阪市役所では、大阪府の候補だけになる（隣接府県データを取得しない）", async () => {
  const regionCheck = lookupRegion(34.6937, 135.5023, boundaries);
  const scope = getShelterSearchScope(regionCheck);
  assert.deepEqual(scope?.prefectureCodes, ["27"]);
  const result = await findFloodShelterCandidates({ lat: 34.6937, lng: 135.5023 }, scope!, 5, diskFetcher);
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.ok(result.candidates.every((c) => c.prefectureCode === "27"));
});
