import { test } from "node:test";
import assert from "node:assert/strict";
import { getShelterStatus } from "./provider.ts";

test("避難所状況: 現時点では常にunknownを返し、混雑度は推測しない（congestion=undefined）", async () => {
  const result = await getShelterStatus("大阪市立西天満小学校");
  assert.equal(result.openStatus, "unknown");
  assert.equal(result.shelterName, "大阪市立西天満小学校");
  assert.equal(result.congestion, undefined);
  assert.equal(result.fetchedAt, null);
  assert.ok(result.sources.length > 0);
  assert.ok(result.sources.every((s) => s.url.startsWith("https://")));
  assert.ok(result.note.length > 0);
});

test("避難所状況: 避難所名を指定しなくても呼び出せる（shelterName=null）", async () => {
  const result = await getShelterStatus();
  assert.equal(result.shelterName, null);
  assert.equal(result.openStatus, "unknown");
});
