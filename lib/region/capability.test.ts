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

test("Phase 4: 京都市(26100)・神戸市(28100)も避難所がsupported（京都府・兵庫県全域データに対応）", () => {
  const kyoto: Region = {
    prefectureCode: "26",
    prefectureName: "京都府",
    municipalityCode: "26100",
    municipalityName: "京都市",
  };
  assert.equal(getRegionCapability(kyoto).shelter, "supported");

  const kobe: Region = {
    prefectureCode: "28",
    prefectureName: "兵庫県",
    municipalityCode: "28100",
    municipalityName: "神戸市",
  };
  assert.equal(getRegionCapability(kobe).shelter, "supported");
});

test("Phase 4: 京都府・兵庫県内でも県庁所在地以外（宇治市・姫路市）は避難所がsupported（府県全域データに対応）", () => {
  const uji: Region = {
    prefectureCode: "26",
    prefectureName: "京都府",
    municipalityCode: "26204",
    municipalityName: "宇治市",
  };
  assert.equal(getRegionCapability(uji).shelter, "supported");

  const himeji: Region = {
    prefectureCode: "28",
    prefectureName: "兵庫県",
    municipalityCode: "28201",
    municipalityName: "姫路市",
  };
  assert.equal(getRegionCapability(himeji).shelter, "supported");
});

test("滋賀県・奈良県・和歌山県（未対応府県）は市区町村が判定できていても避難所がunsupported（他県データを誤って流用しない）", () => {
  const shiga: Region = {
    prefectureCode: "25",
    prefectureName: "滋賀県",
    municipalityCode: "25201",
    municipalityName: "大津市",
  };
  assert.equal(getRegionCapability(shiga).shelter, "unsupported");

  const nara: Region = { prefectureCode: "29", prefectureName: "奈良県" };
  assert.equal(getRegionCapability(nara).shelter, "unsupported");

  const wakayama: Region = { prefectureCode: "30", prefectureName: "和歌山県" };
  assert.equal(getRegionCapability(wakayama).shelter, "unsupported");
});

test("未対応府県は市区町村が判定できていない場合も避難所はunsupported（安全側）", () => {
  const region: Region = { prefectureCode: "29", prefectureName: "奈良県" };
  const capability = getRegionCapability(region);
  assert.equal(capability.shelter, "unsupported");
  assert.equal(capability.inlandFlood, "unsupported");
});

test("奈良県は内水氾濫がunsupported、その他機能はsupported", () => {
  const region: Region = { prefectureCode: "29", prefectureName: "奈良県" };
  const capability = getRegionCapability(region);
  assert.equal(capability.inlandFlood, "unsupported");
  assert.equal(capability.flood, "supported");
  assert.equal(capability.elevation, "supported");
  assert.equal(capability.rainfall, "supported");
});
