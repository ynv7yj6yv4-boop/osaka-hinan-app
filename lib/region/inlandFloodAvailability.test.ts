import { test } from "node:test";
import assert from "node:assert/strict";
import { getInlandFloodAvailability } from "./inlandFloodAvailability.ts";

test("大阪府(27)は既存運用を維持するためsupported", () => {
  assert.equal(getInlandFloodAvailability("27"), "supported");
});

test("滋賀・京都・兵庫は配信URLはあるが実カバー範囲未確認のためunknown（unsupportedと断定しない）", () => {
  assert.equal(getInlandFloodAvailability("25"), "unknown");
  assert.equal(getInlandFloodAvailability("26"), "unknown");
  assert.equal(getInlandFloodAvailability("28"), "unknown");
});

test("奈良・和歌山は配信URL自体が存在しないためunsupported", () => {
  assert.equal(getInlandFloodAvailability("29"), "unsupported");
  assert.equal(getInlandFloodAvailability("30"), "unsupported");
});
