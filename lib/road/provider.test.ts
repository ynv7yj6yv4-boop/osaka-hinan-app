import { test } from "node:test";
import assert from "node:assert/strict";
import { getRoadRestriction } from "./provider.ts";

test("道路規制: 現時点では常にunknownを返し、'安全'相当の値は型として存在しない", async () => {
  const result = await getRoadRestriction("国道2号");
  assert.equal(result.severity, "unknown");
  assert.equal(result.roadName, "国道2号");
  assert.equal(result.fetchedAt, null);
  assert.ok(result.sources.length > 0);
  assert.ok(result.sources.every((s) => s.url.startsWith("https://")));
  assert.ok(result.note.length > 0);
});

test("道路規制: 道路名を指定しなくても呼び出せる（roadName=null）", async () => {
  const result = await getRoadRestriction();
  assert.equal(result.roadName, null);
  assert.equal(result.severity, "unknown");
});
