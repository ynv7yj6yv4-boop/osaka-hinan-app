// Phase 6 PART C: アプリ名称・対象地域表示・初期地図範囲のテスト。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  APP_NAME,
  APP_SHORT_NAME,
  APP_DESCRIPTION,
  APP_TARGET_AREA_LABEL,
  APP_TARGET_PREFECTURES_TEXT,
} from "./appInfo.ts";
import { KINKI_BOUNDS } from "./region/kinkiBounds.generated.ts";

test("アプリ名称は近畿2府4県対応版で、大阪市限定の名称・「近畿全域」という断定を含まない", () => {
  assert.equal(APP_NAME, "近畿 避難支援マップ");
  assert.equal(APP_TARGET_AREA_LABEL, "対象：近畿2府4県");
  for (const text of [APP_NAME, APP_SHORT_NAME, APP_DESCRIPTION, APP_TARGET_AREA_LABEL]) {
    assert.ok(!text.includes("大阪市"), text);
    assert.ok(!text.includes("近畿全域"), text);
  }
});

test("対象府県の表記は6府県すべてを含み、三重県を含まない", () => {
  for (const name of ["滋賀", "京都", "大阪", "兵庫", "奈良", "和歌山"]) {
    assert.ok(APP_TARGET_PREFECTURES_TEXT.includes(name), name);
    assert.ok(APP_DESCRIPTION.includes(name), name);
  }
  assert.ok(!APP_DESCRIPTION.includes("三重"));
});

test("説明文は洪水対応アプリであることを示し、内水氾濫を対象として挙げない", () => {
  assert.ok(APP_DESCRIPTION.includes("洪水"));
  assert.ok(!APP_DESCRIPTION.includes("内水"));
});

test("manifest・metadata・Service Workerの既定通知タイトルはlib/appInfo.tsの名称を参照し、旧名称を直書きしていない", () => {
  for (const file of ["app/manifest.ts", "app/layout.tsx", "app/sw.js/route.ts", "components/MapView.tsx", "components/IntroPanel.tsx"]) {
    const source = readFileSync(file, "utf-8");
    assert.ok(source.includes("APP_NAME"), `${file}がAPP_NAMEを参照していない`);
    assert.ok(!source.includes("大阪市 避難支援マップ"), `${file}に旧名称が残っている`);
    assert.ok(!source.includes("大阪市対象"), `${file}に「大阪市対象」が残っている`);
  }
});

test("初期地図範囲（KINKI_BOUNDS）は境界データの外接矩形と一致し、6府県の府県庁所在地をすべて含む", () => {
  const municipalities = JSON.parse(readFileSync("data/region-boundaries/kinki-municipalities.geojson", "utf-8"));
  let [south, west, north, east] = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = (coords: unknown): void => {
    if (typeof (coords as number[])[0] === "number") {
      const [lng, lat] = coords as number[];
      south = Math.min(south, lat);
      north = Math.max(north, lat);
      west = Math.min(west, lng);
      east = Math.max(east, lng);
      return;
    }
    for (const c of coords as unknown[]) visit(c);
  };
  for (const f of municipalities.features) visit(f.geometry.coordinates);
  const [[s, w], [n, e]] = KINKI_BOUNDS;
  for (const [actual, expected] of [
    [s, south],
    [w, west],
    [n, north],
    [e, east],
  ]) {
    assert.ok(Math.abs(actual - expected) < 0.0001, `KINKI_BOUNDSが境界データと一致しない（再生成が必要）: ${actual} vs ${expected}`);
  }

  const capitals: [string, number, number][] = [
    ["大津市", 35.0045, 135.8686],
    ["京都市", 35.0116, 135.7681],
    ["大阪市", 34.6937, 135.5023],
    ["神戸市", 34.6901, 135.1955],
    ["奈良市", 34.6851, 135.8048],
    ["和歌山市", 34.226, 135.1675],
  ];
  for (const [name, lat, lng] of capitals) {
    assert.ok(lat >= s && lat <= n && lng >= w && lng <= e, `${name}が初期表示範囲に含まれない`);
  }
});
