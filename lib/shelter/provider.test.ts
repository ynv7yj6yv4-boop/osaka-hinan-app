// Phase 3（地域拡張）: ShelterProvider（都道府県単位の避難所データ解決）の
// 単体テスト。
//
// 【テストの構成】
// 1. getShelters()の「都道府県コードからProviderを解決する」部分は、
//    大阪府以外（Provider未登録）ならfetch()を呼ぶ前に同期的に
//    "unsupported"を返すため、ネットワークなしで直接検証できる。
// 2. 実際に生成された public/data/osaka-prefecture-shelters.json の中身
//    （大阪市・堺市・豊中市・東大阪市等で個別レコードが存在すること、
//    flood: true/false/"unknown"の3状態が混同されていないこと）は、
//    fs経由でJSONを直接読み込んで検証する（ブラウザのfetch()を
//    モックする複雑さを避け、実際にscripts/build-shelters.mjsが
//    生成したデータそのものを検証する）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getShelters } from "./provider.ts";
import type { Region } from "../region/types.ts";
import type { Shelter } from "./types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.join(__dirname, "..", "..", "public", "data", "osaka-prefecture-shelters.json");

function makeRegion(overrides: Partial<Region>): Region {
  return { prefectureCode: "27", prefectureName: "大阪府", ...overrides };
}

test("大阪府（27）以外はProvider未登録のため、fetchを呼ばず同期的にunsupportedを返す", async () => {
  const codes: Region["prefectureCode"][] = ["25", "26", "28", "29", "30"];
  for (const prefectureCode of codes) {
    const result = await getShelters(makeRegion({ prefectureCode, prefectureName: "テスト県" }));
    assert.equal(result.status, "unsupported");
  }
});

test("生成データ(osaka-prefecture-shelters.json): 大阪市・堺市・豊中市・東大阪市それぞれで個別レコードが存在する", () => {
  const data = JSON.parse(readFileSync(dataPath, "utf-8")) as { features: Shelter[] };
  const targetMunicipalities = [
    { code: "27100", name: "大阪市" },
    { code: "27140", name: "堺市" },
    { code: "27203", name: "豊中市" },
    { code: "27227", name: "東大阪市" },
  ];
  for (const { code, name } of targetMunicipalities) {
    const records = data.features.filter((f) => f.municipalityCode === code);
    assert.ok(records.length > 0, `${name}(${code})のレコードが存在しない`);
    // 座標・都道府県コードが正しく設定されていることも確認する
    for (const r of records) {
      assert.equal(r.prefectureCode, "27");
      assert.equal(typeof r.lat, "number");
      assert.equal(typeof r.lng, "number");
    }
  }
});

test("生成データ: 指定緊急避難場所のflood状態はtrue/falseのいずれかのみ（unknownにならない）", () => {
  const data = JSON.parse(readFileSync(dataPath, "utf-8")) as { features: Shelter[] };
  const sites = data.features.filter((f) => f.shelterType === "designated_emergency_evacuation_site");
  assert.ok(sites.length > 0);
  for (const s of sites) {
    assert.ok(
      s.supportedDisasters.flood === true || s.supportedDisasters.flood === false,
      `指定緊急避難場所のflood状態がtrue/false以外: ${s.id}=${s.supportedDisasters.flood}`
    );
  }
});

test("生成データ: 指定避難所のflood状態は常にunknown（trueにもfalseにもならない＝データが無い場合を「対応していない」と推測しない）", () => {
  const data = JSON.parse(readFileSync(dataPath, "utf-8")) as { features: Shelter[] };
  const shelters = data.features.filter((f) => f.shelterType === "designated_shelter");
  assert.ok(shelters.length > 0);
  for (const s of shelters) {
    assert.equal(s.supportedDisasters.flood, "unknown", `指定避難所のflood状態がunknownではない: ${s.id}`);
  }
});

test("生成データ: flood true/false/unknownの3状態すべてが実データに存在する（極端な偏りが無いことの確認）", () => {
  const data = JSON.parse(readFileSync(dataPath, "utf-8")) as { features: Shelter[] };
  const counts = { true: 0, false: 0, unknown: 0 };
  for (const f of data.features) {
    const v = f.supportedDisasters.flood;
    if (v === true) counts.true++;
    else if (v === false) counts.false++;
    else counts.unknown++;
  }
  assert.ok(counts.true > 0, "flood:trueのレコードが0件");
  assert.ok(counts.false > 0, "flood:falseのレコードが0件");
  assert.ok(counts.unknown > 0, "flood:unknownのレコードが0件");
});
