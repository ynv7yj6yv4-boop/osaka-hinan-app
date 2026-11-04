// lib/menu/appMenuState.ts の単体テスト（ハンバーガーメニューの開閉・画面遷移）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { appMenuReducer, nextFocusIndex, INITIAL_APP_MENU_STATE } from "./appMenuState.ts";

test("初期状態は閉じている", () => {
  assert.deepEqual(INITIAL_APP_MENU_STATE, { open: false });
});

test("開くとメニュー一覧を表示する", () => {
  assert.deepEqual(appMenuReducer(INITIAL_APP_MENU_STATE, { type: "open" }), { open: true, view: "menu" });
});

test("閉じる・Escape・背景クリックのいずれでも閉じる", () => {
  const opened = appMenuReducer(INITIAL_APP_MENU_STATE, { type: "open" });
  const inAccount = appMenuReducer(opened, { type: "navigate", view: "account" });
  for (const type of ["close", "escape", "backdrop"] as const) {
    assert.deepEqual(appMenuReducer(opened, { type }), { open: false });
    assert.deepEqual(appMenuReducer(inAccount, { type }), { open: false });
  }
});

test("アカウント画面・マイ避難スイッチ設定画面へ移動できる", () => {
  const opened = appMenuReducer(INITIAL_APP_MENU_STATE, { type: "open" });
  assert.deepEqual(appMenuReducer(opened, { type: "navigate", view: "account" }), { open: true, view: "account" });
  assert.deepEqual(appMenuReducer(opened, { type: "navigate", view: "myEvacuationSwitch" }), {
    open: true,
    view: "myEvacuationSwitch",
  });
});

test("戻るでメニュー一覧へ、一覧で戻ると閉じる", () => {
  const sub = appMenuReducer(appMenuReducer(INITIAL_APP_MENU_STATE, { type: "open" }), {
    type: "navigate",
    view: "about",
  });
  const menu = appMenuReducer(sub, { type: "back" });
  assert.deepEqual(menu, { open: true, view: "menu" });
  assert.deepEqual(appMenuReducer(menu, { type: "back" }), { open: false });
});

test("閉じている間のnavigate/backは何もしない", () => {
  assert.deepEqual(appMenuReducer(INITIAL_APP_MENU_STATE, { type: "navigate", view: "account" }), { open: false });
  assert.deepEqual(appMenuReducer(INITIAL_APP_MENU_STATE, { type: "back" }), { open: false });
});

test("フォーカストラップ: 末尾でTabは先頭へ、先頭でShift+Tabは末尾へ", () => {
  assert.equal(nextFocusIndex(2, 3, false), 0);
  assert.equal(nextFocusIndex(0, 3, true), 2);
  assert.equal(nextFocusIndex(1, 3, false), 2);
  assert.equal(nextFocusIndex(-1, 3, false), 0);
  assert.equal(nextFocusIndex(-1, 3, true), 2);
  assert.equal(nextFocusIndex(0, 0, false), -1);
});
