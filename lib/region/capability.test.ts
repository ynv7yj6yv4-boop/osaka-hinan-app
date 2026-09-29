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

test("Phase 5: 滋賀県・奈良県・和歌山県も避難所がsupported（近畿2府4県すべて対応）", () => {
  const otsu: Region = {
    prefectureCode: "25",
    prefectureName: "滋賀県",
    municipalityCode: "25201",
    municipalityName: "大津市",
  };
  assert.equal(getRegionCapability(otsu).shelter, "supported");

  const nara: Region = {
    prefectureCode: "29",
    prefectureName: "奈良県",
    municipalityCode: "29201",
    municipalityName: "奈良市",
  };
  assert.equal(getRegionCapability(nara).shelter, "supported");

  const wakayama: Region = {
    prefectureCode: "30",
    prefectureName: "和歌山県",
    municipalityCode: "30201",
    municipalityName: "和歌山市",
  };
  assert.equal(getRegionCapability(wakayama).shelter, "supported");
});

test("近畿2府4県すべてで、市区町村が判定できていない場合も避難所はsupported（都道府県単位の判定のため）", () => {
  const region: Region = { prefectureCode: "29", prefectureName: "奈良県" };
  const capability = getRegionCapability(region);
  assert.equal(capability.shelter, "supported");
  // inlandFloodは避難所とは独立した判定基準であり、奈良県は引き続きunsupportedのまま
  // （Phase 2の訂正方針を維持。避難所対応拡大とは無関係）。
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
