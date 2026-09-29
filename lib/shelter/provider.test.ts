// Phase 3/4（地域拡張）: ShelterProvider（都道府県単位の避難所データ解決）の
// 単体テスト。
//
// 【テストの構成】
// 1. getShelters()の「都道府県コードからProviderを解決する」部分は、
//    未登録の都道府県（Provider未登録）ならfetch()を呼ぶ前に同期的に
//    "unsupported"を返すため、ネットワークなしで直接検証できる。
//    登録済みの都道府県（大阪・京都・兵庫）は、Node test環境では
//    相対URL(/data/...)のfetch()が失敗する（ブラウザではないため）ことを
//    利用し、"unsupported"ではなく"fetch_error"になることでProvider登録
//    自体を検証する（実際のfetch経由の動作はPlaywright実機検証で確認）。
// 2. 実際に生成された public/data/{osaka,kyoto,hyogo}-prefecture-shelters.json
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

const SUPPORTED_PREFECTURES: { code: PrefectureCode; name: string; slug: string }[] = [
  { code: "27", name: "大阪府", slug: "osaka" },
  { code: "26", name: "京都府", slug: "kyoto" },
  { code: "28", name: "兵庫県", slug: "hyogo" },
];

const UNSUPPORTED_PREFECTURES: { code: PrefectureCode; name: string }[] = [
  { code: "25", name: "滋賀県" },
  { code: "29", name: "奈良県" },
  { code: "30", name: "和歌山県" },
];

test("未対応の都道府県（滋賀・奈良・和歌山）はProvider未登録のため、fetchを呼ばず同期的にunsupportedを返す", async () => {
  for (const { code, name } of UNSUPPORTED_PREFECTURES) {
    const result = await getShelters(makeRegion({ prefectureCode: code, prefectureName: name }));
    assert.equal(result.status, "unsupported", `${name}(${code})がunsupportedを返さない`);
  }
});

test("対応済みの都道府県（大阪・京都・兵庫）はProviderが登録されている（unsupportedにならない）", async () => {
  for (const { code, name } of SUPPORTED_PREFECTURES) {
    const result = await getShelters(makeRegion({ prefectureCode: code, prefectureName: name }));
    // Node test環境には実サーバーが無いため、fetch自体は失敗する(fetch_error)。
    // ここで確認したいのは「Provider未登録によるunsupportedにはならない」こと
    // （＝PROVIDERSに登録されていること）。
    assert.notEqual(result.status, "unsupported", `${name}(${code})がunsupportedになっている（Provider未登録の可能性）`);
  }
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
