// lib/rainfallObservation.ts の単体テスト。ネットワーク不要。
//
// 2026-09-10: formatJmaTimeAsClock()が、JMAのタイムスタンプ(実際はUTC)を
// JSTと誤認識し、変換せずそのまま表示していたバグの回帰テスト
// （実機で「現在地取得は5:44なのに降雨情報は20:40と表示される」という
// 約9時間のズレとして発覚した）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { formatJmaTimeAsClock } from "./rainfallObservation.ts";

test("formatJmaTimeAsClock: UTCのタイムスタンプをJST(UTC+9)へ変換して表示する", () => {
  // 実際に確認した実例: UTC 19:45 のデータは、JSTでは翌日04:45になる
  assert.equal(formatJmaTimeAsClock("20260909194500"), "04:45");
});

test("formatJmaTimeAsClock: 日付をまたがない場合も正しく変換する", () => {
  // UTC 10:00 -> JST 19:00 (同日内)
  assert.equal(formatJmaTimeAsClock("20260909100000"), "19:00");
});

test("formatJmaTimeAsClock: 日付をまたぐ場合(UTCで15時以降)も時刻部分は正しく変換する", () => {
  // UTC 23:50 -> JST 翌日08:50
  assert.equal(formatJmaTimeAsClock("20260909235000"), "08:50");
});

test("formatJmaTimeAsClock: 不正な形式(14桁でない)はそのまま返す", () => {
  assert.equal(formatJmaTimeAsClock("invalid"), "invalid");
});
