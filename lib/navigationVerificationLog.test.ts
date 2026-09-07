// 試作3 次段階 PART 6: lib/navigationVerificationLog.ts の単体テスト（純粋関数のみ）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLogEntry, serializeVerificationLog } from "./navigationVerificationLog.ts";

test("buildLogEntry: 必須項目が正しく設定される", () => {
  const entry = buildLogEntry({
    event: "started",
    navigationStartedAt: "2026-09-08T00:00:00.000Z",
    selectedRouteId: "route-A",
  });
  assert.equal(entry.event, "started");
  assert.equal(entry.selectedRouteId, "route-A");
  assert.equal(entry.position, null);
  assert.equal(entry.navigationEndedAt, null);
});

test("buildLogEntry: 位置情報履歴を保存する項目を持たない（GPS移動履歴を蓄積する構造ではない）", () => {
  const entry = buildLogEntry({
    event: "update",
    navigationStartedAt: "2026-09-08T00:00:00.000Z",
    selectedRouteId: "route-A",
    position: { lat: 34.69, lng: 135.5 },
    gpsAccuracyMeters: 12,
    distanceRemainingMeters: 300,
    currentInstruction: "120m先 左折",
    routeDeviation: false,
    hasArrived: false,
  });
  assert.deepEqual(entry.position, { lat: 34.69, lng: 135.5 });
  assert.equal(entry.gpsAccuracyMeters, 12);
});

test("serializeVerializeLog: JSON文字列として正しくシリアライズされる", () => {
  const entries = [
    buildLogEntry({ event: "started", navigationStartedAt: "t0", selectedRouteId: "route-A" }),
    buildLogEntry({ event: "ended", navigationStartedAt: "t0", selectedRouteId: "route-A", navigationEndedAt: "t1" }),
  ];
  const json = serializeVerificationLog(entries);
  const parsed = JSON.parse(json);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1].navigationEndedAt, "t1");
});
