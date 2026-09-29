// Phase 6 PART D: 市区町村単位の避難所データ提供状況（ShelterDataCompleteness）のテスト。

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { getShelterDataCompleteness, summarizeShelterDataCompleteness } from "./dataCompleteness.ts";
import { getRegionCapability } from "../region/capability.ts";

test("近江八幡市(25204): 指定緊急避難場所は公式に未提供(unavailable)、指定避難所はavailable → partial", () => {
  const c = getShelterDataCompleteness("25204");
  assert.deepEqual(c, { emergencyEvacuationSites: "unavailable", designatedShelters: "available" });
  assert.equal(summarizeShelterDataCompleteness(c), "partial");
});

test("甲良町(25442): 指定緊急避難場所はavailable、指定避難所は公式に未提供(unavailable) → partial", () => {
  const c = getShelterDataCompleteness("25442");
  assert.deepEqual(c, { emergencyEvacuationSites: "available", designatedShelters: "unavailable" });
  assert.equal(summarizeShelterDataCompleteness(c), "partial");
});

test("通常の自治体（大津市・京都市・大阪市・神戸市・奈良市・和歌山市）は両データともavailable（completeとは呼ばない）", () => {
  for (const code of ["25201", "26100", "27100", "28100", "29201", "30201"]) {
    const c = getShelterDataCompleteness(code);
    assert.deepEqual(c, { emergencyEvacuationSites: "available", designatedShelters: "available" }, code);
    assert.equal(summarizeShelterDataCompleteness(c), "available");
  }
});

test("市区町村が判定できない場合・近畿外・実在しない集約コード（和歌山県30000）はunknown（推測でavailableにしない）", () => {
  for (const code of [undefined, "24201", "30000"]) {
    const c = getShelterDataCompleteness(code);
    assert.deepEqual(c, { emergencyEvacuationSites: "unknown", designatedShelters: "unknown" }, String(code));
    assert.equal(summarizeShelterDataCompleteness(c), "unknown");
  }
});

test("滋賀県は部分提供の市町村があっても、RegionCapability.shelterはsupportedのまま（完全性とは別概念）", () => {
  const capability = getRegionCapability({
    prefectureCode: "25",
    prefectureName: "滋賀県",
    municipalityCode: "25204",
    municipalityName: "近江八幡市",
    nearbyPrefectureCodes: [],
  });
  assert.equal(capability.shelter, "supported");
  assert.equal(summarizeShelterDataCompleteness(getShelterDataCompleteness("25204")), "partial");
});

test("生成された提供状況は、近畿2府4県の全市町村について実際のraw CSVの有無と一致する（推測で埋めていない）", () => {
  const municipalities = JSON.parse(readFileSync("data/region-boundaries/kinki-municipalities.geojson", "utf-8"));
  let checked = 0;
  for (const f of municipalities.features) {
    const code: string = f.properties.municipalityCode;
    if (code.endsWith("000")) continue; // 所属未定地等の集約コード（build-shelters.mjsの対象外）
    const hasKinkyu = existsSync(`data/raw/${code}_shitei-kinkyu-hinanbasho.csv`);
    const hasHinanjo = existsSync(`data/raw/${code}_shitei-hinanjo.csv`);
    const c = getShelterDataCompleteness(code);
    assert.equal(c.emergencyEvacuationSites === "available", hasKinkyu, `${code} 指定緊急避難場所`);
    assert.equal(c.designatedShelters === "available", hasHinanjo, `${code} 指定避難所`);
    checked++;
  }
  assert.equal(checked, 198);
});
