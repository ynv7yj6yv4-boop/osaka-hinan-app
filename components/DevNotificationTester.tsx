"use client";

// 試作3 PART C-3・C-4・H: 開発者専用の通知テストUI。
//
// 【重要】このコンポーネントは、環境変数 NEXT_PUBLIC_ENABLE_DEV_TOOLS が
// "1" の場合にのみ描画される(app/layout.tsx参照)。一般公開時にこの変数を
// 設定しなければ、一般ユーザーの画面には一切表示されない。
// また、送信には TEST_NOTIFICATION_SECRET の入力が必要で、サーバー側
// (app/api/test-notification/route.ts)でも一致を検証している。

import { useState } from "react";
import { requestFcmToken, type FcmRegistrationState } from "@/lib/firebaseClient";

const STATE_LABELS: Record<FcmRegistrationState, string> = {
  unsupported: "この端末・ブラウザは通知に対応していません",
  "not-installed": "ホーム画面に追加してから有効化してください（iPhone）",
  "permission-default": "通知の許可待ちです",
  "permission-denied": "通知がブロックされています（ブラウザ設定をご確認ください）",
  registering: "登録しています…",
  enabled: "有効になりました",
  error: "エラーが発生しました",
};

export default function DevNotificationTester() {
  const [state, setState] = useState<FcmRegistrationState | "idle">("idle");
  const [token, setToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);

  const handleEnable = async () => {
    setShowExplanation(false);
    setState("registering");
    const result = await requestFcmToken();
    setState(result.state);
    setMessage("message" in result ? (result.message ?? null) : null);
    setToken(result.state === "enabled" ? result.token : null);
  };

  const handleSendTest = async () => {
    if (!token) return;
    setSendResult("送信中…");
    try {
      const res = await fetch("/api/test-notification", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-notification-secret": secret },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => null);
      setSendResult(
        res.ok ? "送信しました（端末に通知が届くか確認してください）" : `失敗: ${data?.error ?? res.status}`
      );
    } catch (err) {
      setSendResult(`失敗: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="fixed bottom-4 left-4 z-[3000] w-72 max-w-[85vw] rounded-lg border-2 border-purple-400 bg-white p-3 text-xs shadow-lg">
      <p className="font-bold text-purple-700">🛠 開発者用：通知テスト</p>

      {state === "idle" && !showExplanation && (
        <button
          type="button"
          onClick={() => setShowExplanation(true)}
          className="mt-2 w-full rounded bg-purple-700 py-1.5 font-bold text-white"
        >
          災害情報の通知を受け取る
        </button>
      )}

      {/* PART C-3: 起動直後に許可を求めず、説明を挟んでユーザー操作を
          きっかけに許可要求する。 */}
      {showExplanation && state !== "enabled" && (
        <div className="mt-2 rounded bg-purple-50 p-2">
          <p>災害情報の通知を受け取るには、ブラウザの通知許可が必要です。</p>
          <button
            type="button"
            onClick={handleEnable}
            className="mt-2 w-full rounded bg-purple-700 py-1.5 font-bold text-white"
          >
            許可を求める
          </button>
        </div>
      )}

      {state !== "idle" && <p className="mt-2 text-zinc-600">状態：{STATE_LABELS[state]}</p>}
      {message && <p className="text-red-600">{message}</p>}

      {state === "enabled" && token && (
        <>
          <p className="mt-2 break-all text-[10px] text-zinc-400">token: {token.slice(0, 24)}…</p>
          <input
            type="password"
            placeholder="TEST_NOTIFICATION_SECRET"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="mt-2 w-full rounded border border-zinc-300 px-2 py-1"
          />
          <button
            type="button"
            onClick={handleSendTest}
            className="mt-2 w-full rounded bg-emerald-700 py-1.5 font-bold text-white"
          >
            テスト通知を送信
          </button>
          {sendResult && <p className="mt-1 text-zinc-600">{sendResult}</p>}
        </>
      )}
    </div>
  );
}
