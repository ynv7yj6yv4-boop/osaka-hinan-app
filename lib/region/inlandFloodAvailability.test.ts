import { test } from "node:test";
import assert from "node:assert/strict";
import { getInlandFloodAvailability } from "./inlandFloodAvailability.ts";

// Phase 6: この表は内水氾濫を将来再導入する際の調査記録（現在のアプリ動作には使われない）。
test("大阪府(27)は、大阪市にデータが無いことを実測で確認したため、滋賀・京都・兵庫と同じunknown（Phase 6訂正）", () => {
  assert.equal(getInlandFloodAvailability("27"), "unknown");
});

test("滋賀・京都・兵庫は配信URLはあるが一部市町村のみのためunknown（unsupportedと断定しない）", () => {
  assert.equal(getInlandFloodAvailability("25"), "unknown");
  assert.equal(getInlandFloodAvailability("26"), "unknown");
  assert.equal(getInlandFloodAvailability("28"), "unknown");
});

test("奈良・和歌山は配信URL自体が存在しないためunsupported", () => {
  assert.equal(getInlandFloodAvailability("29"), "unsupported");
  assert.equal(getInlandFloodAvailability("30"), "unsupported");
});
