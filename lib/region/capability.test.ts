import { test } from "node:test";
import assert from "node:assert/strict";
import { getRegionCapability } from "./capability.ts";
import type { Region } from "./types.ts";

test("大阪市(27100)は避難所・洪水・標高・降雨がsupported、内水氾濫もsupported（既存運用維持）", () => {
  const region: Region = {
    prefectureCode: "27",
    prefectureName: "大阪府",
    municipalityCode: "27100",
    municipalityName: "大阪市",
  };
  const capability = getRegionCapability(region);
  assert.equal(capability.shelter, "supported");
  assert.equal(capability.flood, "supported");
  assert.equal(capability.elevation, "supported");
  assert.equal(capability.rainfall, "supported");
  assert.equal(capability.inlandFlood, "supported");
});

test("Phase 3: 大阪府内なら大阪市以外（堺市）も避難所がsupported（大阪府全域データに対応）", () => {
  const region: Region = {
    prefectureCode: "27",
    prefectureName: "大阪府",
    municipalityCode: "27140",
    municipalityName: "堺市",
  };
  const capability = getRegionCapability(region);
  assert.equal(capability.shelter, "supported");
});

test("大阪府外（京都府想定）は市区町村が判定できていても避難所がunsupported（大阪府データを誤って流用しない）", () => {
  const region: Region = {
    prefectureCode: "26",
    prefectureName: "京都府",
    municipalityCode: "26100",
    municipalityName: "京都市",
  };
  const capability = getRegionCapability(region);
  assert.equal(capability.shelter, "unsupported");
});

test("市区町村が判定できていない場合も避難所はunsupported（安全側）", () => {
  const region: Region = { prefectureCode: "26", prefectureName: "京都府" };
  const capability = getRegionCapability(region);
  assert.equal(capability.shelter, "unsupported");
  assert.equal(capability.inlandFlood, "unknown");
});

test("奈良県は内水氾濫がunsupported、その他機能はsupported", () => {
  const region: Region = { prefectureCode: "29", prefectureName: "奈良県" };
  const capability = getRegionCapability(region);
  assert.equal(capability.inlandFlood, "unsupported");
  assert.equal(capability.flood, "supported");
  assert.equal(capability.elevation, "supported");
  assert.equal(capability.rainfall, "supported");
});
