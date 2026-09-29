// Phase 3/4/5（地域拡張）: ShelterProvider（都道府県単位の避難所データ解決）の
// 単体テスト。
//
// 【テストの構成】
// 1. getShelters()の「都道府県コードからProviderを解決する」部分は、
//    Node test環境には実サーバーが無いため、登録済みの都道府県への
//    fetch()自体は失敗する（"fetch_error"）。ここで確認したいのは
//    「PROVIDERSに登録されていること（＝unsupportedにならないこと）」。
//    Phase 5で近畿2府4県すべて（25〜30）が登録されたため、有効な
//    PrefectureCodeの値だけでは"unsupported"を再現できない。
//    未登録（＝将来近畿の外を誤って渡してしまった場合の防御コード）の
//    経路は、型システムを迂回した不正な値を渡して検証する。
// 2. 実際に生成された public/data/{prefecture}-prefecture-shelters.json
//    の中身（各府県のサンプル自治体で個別レコードが存在すること、
//    flood: true/false/"unknown"の3状態が混同されていないこと）は、
//    fs経由でJSONを直接読み込んで検証する。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getShelters } from "./provider.ts";
import type { Region, PrefectureCode } from "../region/types.ts";
import type { Shelter } from "./types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function dataPathFor(slug: string): string {
  return path.join(__dirname, "..", "..", "public", "data", `${slug}-prefecture-shelters.json`);
}

function makeRegion(overrides: Partial<Region>): Region {
  return { prefectureCode: "27", prefectureName: "大阪府", ...overrides };
}

const ALL_KINKI_PREFECTURES: { code: PrefectureCode; name: string; slug: string }[] = [
  { code: "25", name: "滋賀県", slug: "shiga" },
  { code: "26", name: "京都府", slug: "kyoto" },
  { code: "27", name: "大阪府", slug: "osaka" },
  { code: "28", name: "兵庫県", slug: "hyogo" },
  { code: "29", name: "奈良県", slug: "nara" },
  { code: "30", name: "和歌山県", slug: "wakayama" },
];

test("近畿2府4県すべて（滋賀・京都・大阪・兵庫・奈良・和歌山）はProviderが登録されている（unsupportedにならない）", async () => {
  for (const { code, name } of ALL_KINKI_PREFECTURES) {
    const result = await getShelters(makeRegion({ prefectureCode: code, prefectureName: name }));
    // Node test環境には実サーバーが無いため、fetch自体は失敗する(fetch_error)。
    // ここで確認したいのは「Provider未登録によるunsupportedにはならない」こと
    // （＝PROVIDERSに登録されていること）。
    assert.notEqual(result.status, "unsupported", `${name}(${code})がunsupportedになっている（Provider未登録の可能性）`);
  }
});

test("生成データ(wakayama-prefecture-shelters.json): 実在しない集約コード30000（所属未定地）のレコードが混入していない（Phase 5で発見・修正した不具合の回帰確認）", () => {
  const data = JSON.parse(readFileSync(dataPathFor("wakayama"), "utf-8")) as { features: Shelter[] };
  const bogus = data.features.filter((f) => f.municipalityCode === "30000");
  assert.equal(bogus.length, 0, "municipalityCode=30000（実在しない集約データ）のレコードが混入している");
  // 30市町村すべてに正しく分散していること（1つの市町村に極端に偏っていないか）も確認
  const byMuni = new Map<string, number>();
  for (const f of data.features) byMuni.set(f.municipalityCode, (byMuni.get(f.municipalityCode) ?? 0) + 1);
  assert.equal(byMuni.size, 30, `和歌山県の市町村数が30件ではない（実際: ${byMuni.size}件）`);
});

test("近畿2府4県の外（Provider未登録の都道府県コード）はunsupportedを返す（型を迂回した防御コードの確認）", async () => {
  // 近畿2府4県すべてにProviderを登録したため、有効なPrefectureCode型の値
  // だけでは未登録ケースを再現できない。三重県(24)を型を迂回して渡し、
  // 「登録されていない都道府県コードが来た場合の安全側フォールバック」が
  // 引き続き機能することを確認する（実際のアプリではcheckRegion()が
  // 近畿2府4県以外をこのRegion型に変換すること自体がない。あくまで
  // 防御コードの単体テスト）。
  const mieRegion = { prefectureCode: "24" as PrefectureCode, prefectureName: "三重県" };
  const result = await getShelters(mieRegion);
  assert.equal(result.status, "unsupported");
});

for (const { name, slug, samples } of [
  {
    name: "大阪府",
    slug: "osaka",
    samples: [
      { code: "27100", name: "大阪市" },
      { code: "27140", name: "堺市" },
      { code: "27203", name: "豊中市" },
      { code: "27227", name: "東大阪市" },
    ],
  },
  {
    name: "京都府",
    slug: "kyoto",
    samples: [
      { code: "26100", name: "京都市" },
      { code: "26204", name: "宇治市" },
      { code: "26206", name: "亀岡市" },
      { code: "26209", name: "長岡京市" },
      { code: "26202", name: "舞鶴市" },
      { code: "26201", name: "福知山市" },
    ],
  },
  {
    name: "兵庫県",
    slug: "hyogo",
    samples: [
      { code: "28100", name: "神戸市" },
      { code: "28202", name: "尼崎市" },
      { code: "28204", name: "西宮市" },
      { code: "28201", name: "姫路市" },
      { code: "28203", name: "明石市" },
      { code: "28214", name: "宝塚市" },
      { code: "28209", name: "豊岡市" },
    ],
  },
  {
    name: "滋賀県",
    slug: "shiga",
    samples: [
      { code: "25201", name: "大津市" },
      { code: "25206", name: "草津市" },
      { code: "25202", name: "彦根市" },
      { code: "25203", name: "長浜市" },
      { code: "25204", name: "近江八幡市" },
      { code: "25209", name: "甲賀市" },
    ],
  },
  {
    name: "奈良県",
    slug: "nara",
    samples: [
      { code: "29201", name: "奈良市" },
      { code: "29205", name: "橿原市" },
      { code: "29209", name: "生駒市" },
      { code: "29203", name: "大和郡山市" },
      { code: "29204", name: "天理市" },
      { code: "29207", name: "五條市" },
    ],
  },
  {
    name: "和歌山県",
    slug: "wakayama",
    samples: [
      { code: "30201", name: "和歌山市" },
      { code: "30202", name: "海南市" },
      { code: "30203", name: "橋本市" },
      { code: "30206", name: "田辺市" },
      { code: "30207", name: "新宮市" },
      { code: "30208", name: "紀の川市" },
    ],
  },
]) {
  test(`生成データ(${slug}-prefecture-shelters.json): ${name}のサンプル自治体それぞれで個別レコードが存在する`, () => {
    const data = JSON.parse(readFileSync(dataPathFor(slug), "utf-8")) as { features: Shelter[] };
    for (const { code, name: muniName } of samples) {
      const records = data.features.filter((f) => f.municipalityCode === code);
      assert.ok(records.length > 0, `${muniName}(${code})のレコードが存在しない`);
      for (const r of records) {
        assert.equal(typeof r.lat, "number");
        assert.equal(typeof r.lng, "number");
      }
    }
  });

  test(`生成データ(${slug}-prefecture-shelters.json): 指定緊急避難場所のflood状態はtrue/falseのいずれかのみ（unknownにならない）`, () => {
    const data = JSON.parse(readFileSync(dataPathFor(slug), "utf-8")) as { features: Shelter[] };
    const sites = data.features.filter((f) => f.shelterType === "designated_emergency_evacuation_site");
    assert.ok(sites.length > 0);
    for (const s of sites) {
      assert.ok(
        s.supportedDisasters.flood === true || s.supportedDisasters.flood === false,
        `指定緊急避難場所のflood状態がtrue/false以外: ${s.id}=${s.supportedDisasters.flood}`
      );
    }
  });

  test(`生成データ(${slug}-prefecture-shelters.json): 指定避難所のflood状態は常にunknown（対応していないと推測しない）`, () => {
    const data = JSON.parse(readFileSync(dataPathFor(slug), "utf-8")) as { features: Shelter[] };
    const shelters = data.features.filter((f) => f.shelterType === "designated_shelter");
    assert.ok(shelters.length > 0);
    for (const s of shelters) {
      assert.equal(s.supportedDisasters.flood, "unknown", `指定避難所のflood状態がunknownではない: ${s.id}`);
    }
  });

  test(`生成データ(${slug}-prefecture-shelters.json): flood true/false/unknownの3状態すべてが実データに存在する`, () => {
    const data = JSON.parse(readFileSync(dataPathFor(slug), "utf-8")) as { features: Shelter[] };
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
}
