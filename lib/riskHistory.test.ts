// lib/riskHistory.ts の単体テスト。
//
// compareRiskLevels()・formatPreviousCheckedAt()はlocalStorageに一切触れない
// 純粋関数のため直接検証する。recordRiskHistoryEntry()/getRiskHistory()は
// 本物のwindow.localStorageの代わりに、テスト専用のインメモリstorageを
// 注入して検証する(実際のブラウザ環境が無いNode環境でも検証できるようにするため)。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareRiskLevels,
  formatPreviousCheckedAt,
  recordRiskHistoryEntry,
  getRiskHistory,
  MAX_HISTORY_ENTRIES,
} from "./riskHistory.ts";

function createFakeStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

// --- compareRiskLevels (意味ベースの比較) ---

test("初回(previousがnull)はno_previous", () => {
  assert.deepEqual(compareRiskLevels(null, "safe"), { kind: "no_previous" });
});

test("safe → caution は increased", () => {
  assert.deepEqual(compareRiskLevels("safe", "caution"), { kind: "increased" });
});

test("caution → prepare は increased", () => {
  assert.deepEqual(compareRiskLevels("caution", "prepare"), { kind: "increased" });
});

test("prepare → caution は decreased", () => {
  assert.deepEqual(compareRiskLevels("prepare", "caution"), { kind: "decreased" });
});

test("caution → caution は same", () => {
  assert.deepEqual(compareRiskLevels("caution", "caution"), { kind: "same" });
});

test("unknown → caution は unknown_previous(比較可能な情報を取得)", () => {
  assert.deepEqual(compareRiskLevels("unknown", "caution"), { kind: "unknown_previous" });
});

test("caution → unknown は unknown_now(現在の比較ができない)", () => {
  assert.deepEqual(compareRiskLevels("caution", "unknown"), { kind: "unknown_now" });
});

test("unknown → unknown は both_unknown(比較できない)", () => {
  assert.deepEqual(compareRiskLevels("unknown", "unknown"), { kind: "both_unknown" });
});

test("【重要】unknownはsafeより低い/prepareより高い、として比較されない(safe→evacuateでも数値順のみで判定)", () => {
  // evacuateはRiskLevel型に含まれるため念のため確認する(現状の判定ロジックでは
  // 到達しないが、型としては存在するため比較ロジックが壊れていないことを保証する)。
  assert.deepEqual(compareRiskLevels("safe", "evacuate"), { kind: "increased" });
  assert.deepEqual(compareRiskLevels("evacuate", "safe"), { kind: "decreased" });
});

// --- formatPreviousCheckedAt ---

test("formatPreviousCheckedAt: 1分未満は「たった今」", () => {
  const now = new Date("2026-09-26T10:00:00.000Z");
  assert.equal(formatPreviousCheckedAt("2026-09-26T09:59:30.000Z", now), "たった今");
});

test("formatPreviousCheckedAt: 30分前は「30分前」", () => {
  const now = new Date("2026-09-26T10:00:00.000Z");
  assert.equal(formatPreviousCheckedAt("2026-09-26T09:30:00.000Z", now), "30分前");
});

test("formatPreviousCheckedAt: 同じ日で1時間以上前はHH:MM表記", () => {
  const now = new Date("2026-09-26T10:00:00.000Z");
  const result = formatPreviousCheckedAt("2026-09-26T01:20:00.000Z", now);
  // タイムゾーン依存を避けるため、コロン区切りの時刻表記であることのみ検証する。
  assert.match(result, /^\d{1,2}:\d{2}$/);
});

// --- recordRiskHistoryEntry / getRiskHistory(インメモリstorage注入) ---

test("初回のrecordは必ず保存され、previousはnull・comparisonはno_previous", () => {
  const storage = createFakeStorage();
  const result = recordRiskHistoryEntry("safe", "2026-09-26T10:00:00.000Z", storage);
  assert.equal(result.previous, null);
  assert.deepEqual(result.comparison, { kind: "no_previous" });
  assert.deepEqual(getRiskHistory(storage), [{ level: "safe", evaluatedAt: "2026-09-26T10:00:00.000Z" }]);
});

test("同じlevelを連続して記録しても重複保存しない", () => {
  const storage = createFakeStorage();
  recordRiskHistoryEntry("safe", "2026-09-26T10:00:00.000Z", storage);
  const second = recordRiskHistoryEntry("safe", "2026-09-26T10:05:00.000Z", storage);

  assert.deepEqual(second.previous, { level: "safe", evaluatedAt: "2026-09-26T10:00:00.000Z" });
  assert.deepEqual(second.comparison, { kind: "same" });
  // 2回目は保存されないため、履歴は1件のまま(2件目の時刻で上書きもしない)。
  assert.equal(getRiskHistory(storage).length, 1);
  assert.equal(getRiskHistory(storage)[0].evaluatedAt, "2026-09-26T10:00:00.000Z");
});

test("levelが変化した場合は新しいエントリとして追記される", () => {
  const storage = createFakeStorage();
  recordRiskHistoryEntry("safe", "2026-09-26T10:00:00.000Z", storage);
  const second = recordRiskHistoryEntry("caution", "2026-09-26T10:30:00.000Z", storage);

  assert.deepEqual(second.comparison, { kind: "increased" });
  assert.deepEqual(getRiskHistory(storage), [
    { level: "safe", evaluatedAt: "2026-09-26T10:00:00.000Z" },
    { level: "caution", evaluatedAt: "2026-09-26T10:30:00.000Z" },
  ]);
});

test(`履歴は直近${MAX_HISTORY_ENTRIES}件を超えて保存しない`, () => {
  const storage = createFakeStorage();
  const levels: Array<"safe" | "caution"> = [];
  for (let i = 0; i < MAX_HISTORY_ENTRIES + 5; i++) {
    levels.push(i % 2 === 0 ? "safe" : "caution");
  }
  levels.forEach((level, i) => {
    recordRiskHistoryEntry(level, `2026-09-26T${String(10 + i).padStart(2, "0")}:00:00.000Z`, storage);
  });

  const history = getRiskHistory(storage);
  assert.equal(history.length, MAX_HISTORY_ENTRIES);
  // 末尾(最新)は最後に記録したlevelと一致する。
  assert.equal(history[history.length - 1].level, levels[levels.length - 1]);
});

test("storageが例外を投げても(壊れていても)recordRiskHistoryEntryは例外を投げず安全側の結果を返す", () => {
  const brokenStorage = {
    getItem: () => {
      throw new Error("quota exceeded (simulated)");
    },
    setItem: () => {
      throw new Error("quota exceeded (simulated)");
    },
  };
  const result = recordRiskHistoryEntry("caution", "2026-09-26T10:00:00.000Z", brokenStorage);
  assert.deepEqual(result, { previous: null, comparison: { kind: "no_previous" } });
});
