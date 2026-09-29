// Phase 7: API Routeの認証分類と、認証まわりの安全上の不変条件のテスト。
// Clerkへの実通信は行わず、ソースコードと分類表（routeAccess.ts）を照合する。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { ROUTE_ACCESS } from "./routeAccess.ts";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** app/配下のroute.ts(x)を、URLパス（例: /api/region）へ変換した一覧。 */
function actualRouteHandlers(): Map<string, string> {
  const map = new Map<string, string>();
  for (const file of walk("app")) {
    if (!/[\\/]route\.tsx?$/.test(file)) continue;
    const route = "/" + path.relative("app", path.dirname(file)).split(path.sep).join("/");
    map.set(route, file);
  }
  return map;
}

test("app/配下のすべてのRoute Handlerが、routeAccess.tsで認証要否を分類されている（分類漏れなし）", () => {
  const classified = new Set(ROUTE_ACCESS.map((e) => e.route));
  const missing = [...actualRouteHandlers().keys()].filter((r) => !classified.has(r));
  assert.deepEqual(missing, [], `分類されていないRoute Handler: ${missing.join(", ")}`);
});

test("分類表に、実在しないルートが残っていない", () => {
  const actual = actualRouteHandlers();
  const stale = ROUTE_ACCESS.filter((e) => !actual.has(e.route)).map((e) => e.route);
  assert.deepEqual(stale, []);
});

test("clerk_session_requiredのAPIは、すべてのHTTPメソッドの先頭でrequireApiAuth()を呼ぶ", () => {
  const files = actualRouteHandlers();
  for (const entry of ROUTE_ACCESS.filter((e) => e.access === "clerk_session_required")) {
    const source = readFileSync(files.get(entry.route)!, "utf-8");
    const handlers = source.match(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g) ?? [];
    const checks = source.match(/await requireApiAuth\(\)/g) ?? [];
    assert.ok(handlers.length > 0, entry.route);
    assert.equal(checks.length, handlers.length, `${entry.route}: 認証チェックの無いメソッドがある`);
  }
});

test("Cron・テスト通知（server_secret）は、Clerkのセッションを要求せず、共有シークレットで保護されている", () => {
  const files = actualRouteHandlers();
  for (const entry of ROUTE_ACCESS.filter((e) => e.access === "server_secret")) {
    const source = readFileSync(files.get(entry.route)!, "utf-8");
    assert.doesNotMatch(source, /requireApiAuth|auth\.protect|@clerk\/nextjs/, `${entry.route}がClerkのセッションに依存している`);
    assert.match(source, /process\.env\.(CRON_SECRET|TEST_NOTIFICATION_SECRET)/, `${entry.route}に共有シークレットの確認が無い`);
    assert.match(source, /status: 401/);
  }
});

test("研究用API（dev_only）は、本番環境で403を返す", () => {
  const files = actualRouteHandlers();
  for (const entry of ROUTE_ACCESS.filter((e) => e.access === "dev_only")) {
    const source = readFileSync(files.get(entry.route)!, "utf-8");
    assert.match(source, /process\.env\.NODE_ENV === "production"/, entry.route);
    assert.match(source, /status: 403/, entry.route);
  }
});

test("PWAに必要な公開リソース（Service Worker・アイコン）は、Clerkのセッションを要求しない", () => {
  const files = actualRouteHandlers();
  for (const entry of ROUTE_ACCESS.filter((e) => e.access === "public")) {
    const source = readFileSync(files.get(entry.route)!, "utf-8");
    assert.doesNotMatch(source, /requireApiAuth|auth\.protect|await auth\(\)/, entry.route);
  }
});

test("proxy.tsは一括保護（createRouteMatcher・auth.protect）を行わず、manifest・静的ファイルを対象外にする", () => {
  // コメント（設計理由の説明）は除いたコードだけを検査する
  const source = readFileSync("proxy.ts", "utf-8").replace(/^\s*\/\/.*$/gm, "");
  assert.match(source, /clerkMiddleware\(\)/);
  assert.doesNotMatch(source, /createRouteMatcher|auth\.protect|\.protect\(/);
  // matcherが除外する拡張子に、PWAに必要なmanifest・JS（Service Worker）・画像が含まれる
  assert.match(source, /webmanifest/);
  assert.match(source, /js\(\?!on\)/);
  assert.match(source, /png/);
});

test("Next.js 16の規約どおりproxy.tsを使い、middleware.tsを作っていない", () => {
  assert.throws(() => statSync("middleware.ts"));
  assert.ok(statSync("proxy.ts").isFile());
});

test("地図ページ（app/page.tsx）はサーバー側でログインを確認し、未ログインならサインインへ移動する", () => {
  const source = readFileSync("app/page.tsx", "utf-8");
  assert.match(source, /await auth\(\)/);
  assert.match(source, /redirectToSignIn\(\)/);
});

// ---- 個人情報・秘密値の取り扱い（ソースコード上の不変条件） ----

const AUTH_CLIENT_FILES = [
  ...walk("components/auth"),
  "components/AccountMenu.tsx",
  "lib/auth/authErrorMessages.ts",
  "lib/auth/authConfig.ts",
];

test("認証画面・アカウントメニューでconsole出力・localStorage/sessionStorage・独自Cookieを使っていない", () => {
  for (const file of AUTH_CLIENT_FILES) {
    const source = readFileSync(file, "utf-8");
    assert.doesNotMatch(source, /console\.(log|error|warn|info|debug)/, `${file}にconsole出力がある`);
    assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie|indexedDB/, `${file}が認証情報を端末に保存している可能性`);
  }
});

test("メールアドレスをURLのクエリへ入れていない（認証画面の遷移先に個人情報を含めない）", () => {
  for (const file of AUTH_CLIENT_FILES) {
    const source = readFileSync(file, "utf-8");
    assert.doesNotMatch(source, /[?&](email|emailAddress|identifier)=/, file);
  }
});

test("Clerkの秘密鍵（CLERK_SECRET_KEY）をクライアントコードから参照していない", () => {
  const clientFiles = [...walk("components"), ...walk("app"), ...walk("lib")].filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts"));
  for (const file of clientFiles) {
    const source = readFileSync(file, "utf-8");
    assert.doesNotMatch(source, /CLERK_SECRET_KEY/, `${file}がCLERK_SECRET_KEYを参照している`);
  }
});

test(".env系ファイルとClerk keylessモードの一時キー（.clerk/）はGit管理外", () => {
  const gitignore = readFileSync(".gitignore", "utf-8");
  assert.match(gitignore, /^\.env\*$/m);
  assert.match(gitignore, /^\.clerk\/$/m);
});

test("Clerk→Firebase Authentication連携（custom token・Firebase Integration）を実装していない", () => {
  const files = [...walk("components"), ...walk("app"), ...walk("lib")].filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts"));
  for (const file of files) {
    const source = readFileSync(file, "utf-8");
    assert.doesNotMatch(source, /signInWithCustomToken|integration_firebase|firebase\/auth|createCustomToken/, file);
  }
});
