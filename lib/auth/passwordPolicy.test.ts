// Phase 7: Clerkのパスワードポリシー → 表示文言の組み立てのテスト（Clerkへの通信なし）。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describePasswordPolicy,
  frontendApiHostFromPublishableKey,
  FALLBACK_PASSWORD_REQUIREMENT_TEXT,
} from "./passwordPolicy.ts";

test("Clerkに設定された最小文字数をそのまま表示する（アプリ側で独自の数値を作らない）", () => {
  assert.match(describePasswordPolicy({ min_length: 15, disable_hibp: false }), /^15文字以上。/);
  assert.match(describePasswordPolicy({ min_length: 8 }), /^8文字以上。/);
});

test("流出パスワードの拒否（HIBP）が有効な場合のみ、その旨を表示する", () => {
  assert.match(describePasswordPolicy({ min_length: 15, disable_hibp: false }), /流出/);
  assert.doesNotMatch(describePasswordPolicy({ min_length: 15, disable_hibp: true }), /流出/);
});

test("文字種の必須条件（英小文字・英大文字・数字・記号）を日本語で表示する", () => {
  const text = describePasswordPolicy({
    min_length: 12,
    require_lowercase: true,
    require_uppercase: true,
    require_numbers: true,
    require_special_char: true,
  });
  assert.match(text, /12文字以上、英小文字・英大文字・数字・記号を含む。/);
});

test("ポリシーを取得できない場合は、具体的な数値を断定しない汎用文言にする", () => {
  assert.equal(describePasswordPolicy(null), FALLBACK_PASSWORD_REQUIREMENT_TEXT);
  assert.doesNotMatch(FALLBACK_PASSWORD_REQUIREMENT_TEXT, /\d+文字/);
});

test("公開鍵からClerk Frontend APIのホスト名を取り出す（不正な値はnull）", () => {
  const host = "example-app-1.clerk.accounts.dev";
  const pk = `pk_test_${btoa(host + "$")}`;
  assert.equal(frontendApiHostFromPublishableKey(pk), host);
  assert.equal(frontendApiHostFromPublishableKey(undefined), null);
  assert.equal(frontendApiHostFromPublishableKey("pk_test_"), null);
  assert.equal(frontendApiHostFromPublishableKey(`pk_test_${btoa("evil.com/path?x=1$")}`), null);
});
