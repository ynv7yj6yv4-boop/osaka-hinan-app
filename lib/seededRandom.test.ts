// lib/seededRandom.ts の単体テスト。ネットワーク不要。

import { test } from "node:test";
import assert from "node:assert/strict";
import { createSeededRandom, seededShuffle } from "./seededRandom.ts";

test("createSeededRandom: 同じseedなら同じ数列を再現する", () => {
  const r1 = createSeededRandom(2900457335);
  const r2 = createSeededRandom(2900457335);
  const seq1 = Array.from({ length: 10 }, () => r1());
  const seq2 = Array.from({ length: 10 }, () => r2());
  assert.deepEqual(seq1, seq2);
});

test("createSeededRandom: 違うseedなら異なる数列になる", () => {
  const r1 = createSeededRandom(1);
  const r2 = createSeededRandom(2);
  assert.notEqual(r1(), r2());
});

test("createSeededRandom: 生成される値は常に[0, 1)の範囲", () => {
  const r = createSeededRandom(42);
  for (let i = 0; i < 1000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1);
  }
});

test("seededShuffle: 同じseedなら同じ並び順を再現する(再現性)", () => {
  const items = Array.from({ length: 20 }, (_, i) => i);
  const result1 = seededShuffle(items, createSeededRandom(2900457335));
  const result2 = seededShuffle(items, createSeededRandom(2900457335));
  assert.deepEqual(result1, result2);
});

test("seededShuffle: 元配列を変更しない", () => {
  const items = [1, 2, 3, 4, 5];
  const copy = [...items];
  seededShuffle(items, createSeededRandom(1));
  assert.deepEqual(items, copy);
});

test("seededShuffle: 全要素を過不足なく含む(順序だけが変わる)", () => {
  const items = Array.from({ length: 30 }, (_, i) => i);
  const result = seededShuffle(items, createSeededRandom(999));
  assert.deepEqual([...result].sort((a, b) => a - b), items);
});
