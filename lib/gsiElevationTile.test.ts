// lib/gsiElevationTile.ts の単体テスト。
// 実ネットワークは使わず、DemFetchFnをモックして検証する。
// タイル座標変換の期待値は、実際に大阪市内の座標(34.6937, 135.5023)で
// 国土地理院の標高タイルAPIを2026-09-26に実際に取得・検証した際の
// 計算結果(z=15: x=28717,y=13013 / z=14: x=14358,y=6506)と一致させている。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lngLatToDemTileCoord,
  parseDemTileText,
  createElevationTileCache,
  getElevationAtPoint,
  type DemFetchFn,
} from "./gsiElevationTile.ts";

test("lngLatToDemTileCoord: 実データで検証済みの座標と一致する(z=15)", () => {
  const coord = lngLatToDemTileCoord(34.6937, 135.5023, 15);
  assert.equal(coord.x, 28717);
  assert.equal(coord.y, 13013);
  assert.equal(coord.z, 15);
  assert.ok(coord.px >= 0 && coord.px <= 255);
  assert.ok(coord.py >= 0 && coord.py <= 255);
});

test("lngLatToDemTileCoord: 実データで検証済みの座標と一致する(z=14)", () => {
  const coord = lngLatToDemTileCoord(34.6937, 135.5023, 14);
  assert.equal(coord.x, 14358);
  assert.equal(coord.y, 6506);
});

test("parseDemTileText: カンマ区切りの数値をパースする", () => {
  const grid = parseDemTileText("1.09,1.15,1.20\n2.00,2.10,2.20");
  assert.deepEqual(grid, [
    [1.09, 1.15, 1.2],
    [2.0, 2.1, 2.2],
  ]);
});

test("parseDemTileText: 欠損値'e'はnullにする(0扱いにしない)", () => {
  const grid = parseDemTileText("1.0,e,2.0");
  assert.deepEqual(grid, [[1.0, null, 2.0]]);
});

test("parseDemTileText: 末尾の空行は無視する", () => {
  const grid = parseDemTileText("1.0,2.0\n3.0,4.0\n");
  assert.equal(grid.length, 2);
});

function makeGridResponse(fillValue: number | "e"): { ok: true; text: () => Promise<string> } {
  const row = Array(256).fill(fillValue).join(",");
  const text = Array(256).fill(row).join("\n");
  return { ok: true, text: async () => text };
}

test("getElevationAtPoint: 最も精度の高いdem5aで値が取れればそれを使う", async () => {
  const calls: string[] = [];
  const fetchFn: DemFetchFn = async (url) => {
    calls.push(url);
    if (url.includes("/dem5a/")) return makeGridResponse(12.34);
    throw new Error("dem5a以外は呼ばれないはず");
  };
  const cache = createElevationTileCache();
  const result = await getElevationAtPoint(34.6937, 135.5023, cache, fetchFn);
  assert.deepEqual(result, { elevationMeters: 12.34, source: "dem5a" });
  assert.equal(calls.length, 1);
});

test("getElevationAtPoint: dem5aが404(未整備)ならdem5bへfallbackする", async () => {
  const fetchFn: DemFetchFn = async (url) => {
    if (url.includes("/dem5a/")) return { ok: false, text: async () => "" };
    if (url.includes("/dem5b/")) return makeGridResponse(9.87);
    throw new Error("想定外のURL");
  };
  const cache = createElevationTileCache();
  const result = await getElevationAtPoint(34.6937, 135.5023, cache, fetchFn);
  assert.deepEqual(result, { elevationMeters: 9.87, source: "dem5b" });
});

test("getElevationAtPoint: dem5a/dem5bとも取得できない地点はdem10b(シームレス)へfallbackする", async () => {
  const fetchFn: DemFetchFn = async (url) => {
    if (url.includes("/dem5a/") || url.includes("/dem5b/")) return { ok: false, text: async () => "" };
    if (url.includes("/xyz/dem/")) return makeGridResponse(3.21);
    throw new Error("想定外のURL");
  };
  const cache = createElevationTileCache();
  const result = await getElevationAtPoint(34.6937, 135.5023, cache, fetchFn);
  assert.deepEqual(result, { elevationMeters: 3.21, source: "dem10b" });
});

test("getElevationAtPoint: 該当セルが欠損値('e')の場合も次のtierへfallbackする", async () => {
  const fetchFn: DemFetchFn = async (url) => {
    if (url.includes("/dem5a/")) return makeGridResponse("e");
    if (url.includes("/dem5b/")) return makeGridResponse(5.5);
    throw new Error("想定外のURL");
  };
  const cache = createElevationTileCache();
  const result = await getElevationAtPoint(34.6937, 135.5023, cache, fetchFn);
  assert.deepEqual(result, { elevationMeters: 5.5, source: "dem5b" });
});

test("getElevationAtPoint: 全tierで取得できない場合はunknownを返し、例外を投げない", async () => {
  const fetchFn: DemFetchFn = async () => ({ ok: false, text: async () => "" });
  const cache = createElevationTileCache();
  const result = await getElevationAtPoint(34.6937, 135.5023, cache, fetchFn);
  assert.deepEqual(result, { elevationMeters: null, source: "unknown" });
});

test("getElevationAtPoint: fetchFnが例外を投げても落ちずunknownを返す(通信エラー・タイムアウト等)", async () => {
  const fetchFn: DemFetchFn = async () => {
    throw new Error("network error (simulated)");
  };
  const cache = createElevationTileCache();
  const result = await getElevationAtPoint(34.6937, 135.5023, cache, fetchFn);
  assert.deepEqual(result, { elevationMeters: null, source: "unknown" });
});

test("【重要】同じタイルに複数地点が含まれる場合、キャッシュにより実際のfetchは1回だけになる", async () => {
  let fetchCount = 0;
  const fetchFn: DemFetchFn = async (url) => {
    if (url.includes("/dem5a/")) {
      fetchCount++;
      return makeGridResponse(1.0);
    }
    throw new Error("想定外");
  };
  const cache = createElevationTileCache();
  // ごく近い2地点(同じタイル内に収まる程度の差)を評価する
  await getElevationAtPoint(34.6937, 135.5023, cache, fetchFn);
  await getElevationAtPoint(34.69371, 135.50231, cache, fetchFn);
  await getElevationAtPoint(34.69372, 135.50229, cache, fetchFn);
  assert.equal(fetchCount, 1, "同一タイルへの重複fetchが発生している");
});

test("キャッシュを共有しない場合は、同じタイルでも呼び出しごとにfetchする(cache有無の対照確認)", async () => {
  let fetchCount = 0;
  const fetchFn: DemFetchFn = async (url) => {
    if (url.includes("/dem5a/")) {
      fetchCount++;
      return makeGridResponse(1.0);
    }
    throw new Error("想定外");
  };
  await getElevationAtPoint(34.6937, 135.5023, createElevationTileCache(), fetchFn);
  await getElevationAtPoint(34.6937, 135.5023, createElevationTileCache(), fetchFn);
  assert.equal(fetchCount, 2);
});
