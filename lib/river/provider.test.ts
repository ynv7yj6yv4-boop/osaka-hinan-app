import { test } from "node:test";
import assert from "node:assert/strict";
import { getRiverStatus } from "./provider.ts";

test("河川状況: 現時点では常にunknownを返し、断定的な安全/危険判定をしない", async () => {
  const result = await getRiverStatus("淀川");
  assert.equal(result.level, "unknown");
  assert.equal(result.riverName, "淀川");
  assert.equal(result.fetchedAt, null);
  assert.ok(result.source.url.startsWith("https://"));
  assert.ok(result.note.length > 0);
});

test("河川状況: 河川名を指定しなくても呼び出せる（riverName=null）", async () => {
  const result = await getRiverStatus();
  assert.equal(result.riverName, null);
  assert.equal(result.level, "unknown");
});
