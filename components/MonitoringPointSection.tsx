"use client";

// 試作3 PART D: RiskDetailModal内に組み込む「通知対象地点」の登録・管理UI。
//
// 【重要】ここで有効化するのは通知の"登録"のみ。実際の自動通知判定ルール
// (PART F-3)はまだ人間の確認前のため有効化していない(サーバー側の
// 定期監視ジョブ自体、この時点ではまだ実装していない)。

import { useEffect, useState } from "react";
import { requestFcmToken } from "@/lib/firebaseClient";
import {
  getSavedMonitoringPointId,
  registerMonitoringPoint,
  fetchMonitoringPoint,
  deleteMonitoringPoint,
  setMonitoringPointEnabled,
  type MonitoringPointInfo,
} from "@/lib/monitoringPoints";

type Step = "loading" | "not-registered" | "explaining" | "registered";

export default function MonitoringPointSection({ position }: { position: { lat: number; lng: number } }) {
  // localStorageの読み取りは同期処理のため、useStateの初期値として直接
  // 評価する(IntroPanel.tsxのisIosSafariNotStandaloneと同じ方針)。
  // これにより、effect内で同期的にsetStateを呼ぶ必要がなくなる。
  const [step, setStep] = useState<Step>(() => (getSavedMonitoringPointId() ? "loading" : "not-registered"));
  const [info, setInfo] = useState<MonitoringPointInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = getSavedMonitoringPointId();
    if (!id) return; // 上のuseStateで既にnot-registeredになっている

    let cancelled = false;
    fetchMonitoringPoint(id).then((result) => {
      if (cancelled) return;
      if (result) {
        setInfo(result);
        setStep("registered");
      } else {
        setStep("not-registered");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // PART C-3: 起動直後に許可を求めず、説明を挟んでユーザー操作をきっかけに
  // 通知許可を要求する（この処理はボタン押下から呼ばれる）。
  const handleRegister = async () => {
    setBusy(true);
    setErrorMessage(null);
    const tokenResult = await requestFcmToken();
    if (tokenResult.state !== "enabled") {
      setErrorMessage(
        "message" in tokenResult && tokenResult.message ? tokenResult.message : "通知を有効にできませんでした"
      );
      setBusy(false);
      return;
    }
    const result = await registerMonitoringPoint({
      latitude: position.lat,
      longitude: position.lng,
      fcmToken: tokenResult.token,
    });
    if (!result.ok) {
      setErrorMessage(result.error);
      setBusy(false);
      return;
    }
    const details = await fetchMonitoringPoint(result.id);
    setInfo(details);
    setStep("registered");
    setBusy(false);
  };

  const handleDelete = async () => {
    if (!info) return;
    setBusy(true);
    setErrorMessage(null);
    const tokenResult = await requestFcmToken();
    if (tokenResult.state !== "enabled") {
      setErrorMessage("削除するには通知の許可状態が必要です");
      setBusy(false);
      return;
    }
    const ok = await deleteMonitoringPoint(info.monitoringPointId, tokenResult.token);
    setBusy(false);
    if (ok) {
      setInfo(null);
      setStep("not-registered");
    } else {
      setErrorMessage("削除に失敗しました");
    }
  };

  const handleToggle = async (enabled: boolean) => {
    if (!info) return;
    setBusy(true);
    setErrorMessage(null);
    const tokenResult = await requestFcmToken();
    if (tokenResult.state !== "enabled") {
      setErrorMessage("操作するには通知の許可状態が必要です");
      setBusy(false);
      return;
    }
    const ok = await setMonitoringPointEnabled(info.monitoringPointId, tokenResult.token, enabled);
    setBusy(false);
    if (ok) setInfo({ ...info, notificationEnabled: enabled });
    else setErrorMessage("更新に失敗しました");
  };

  return (
    <section className="mt-4 rounded-lg border-2 border-blue-200 bg-blue-50 p-3">
      <h2 className="text-base font-bold text-zinc-900">🔔 この場所の災害情報を通知（試作機能）</h2>

      {step === "loading" && <p className="mt-1 text-sm text-zinc-600">確認しています…</p>}

      {step === "not-registered" && (
        <>
          <p className="mt-1 text-sm text-zinc-700">
            この地点を通知対象として登録すると、アプリを閉じていても災害情報をお知らせできるようになります。
            <br />
            ※現時点では登録のみ実装済みで、実際に自動で通知を送る判定ルールはまだ有効化していません（人間の確認後に有効化予定）。
          </p>
          <button
            type="button"
            onClick={() => setStep("explaining")}
            className="mt-2 w-full rounded-lg bg-blue-700 py-2.5 text-sm font-bold text-white active:bg-blue-800"
          >
            この場所を通知対象として登録
          </button>
        </>
      )}

      {step === "explaining" && (
        <div className="mt-2 rounded-lg bg-white p-2">
          <p className="text-xs text-zinc-600">
            通知を受け取るには、ブラウザの通知許可が必要です。次に表示される確認画面で「許可」を選んでください。
          </p>
          <button
            type="button"
            onClick={handleRegister}
            disabled={busy}
            className="mt-2 w-full rounded-lg bg-blue-700 py-2 text-sm font-bold text-white disabled:opacity-60"
          >
            {busy ? "登録しています…" : "許可して登録する"}
          </button>
        </div>
      )}

      {step === "registered" && info && (
        <div className="mt-2">
          <p className="text-sm text-zinc-700">
            登録中：緯度{info.latitude.toFixed(4)}・経度{info.longitude.toFixed(4)}付近
          </p>
          <p className="mt-1 text-xs text-zinc-500">対象ハザード：洪水・内水氾濫（高潮は対象外）</p>
          <p className="mt-1 text-xs text-zinc-500">通知：{info.notificationEnabled ? "有効" : "停止中"}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => handleToggle(!info.notificationEnabled)}
              disabled={busy}
              className="flex-1 rounded-lg border-2 border-zinc-300 py-2 text-sm font-bold text-zinc-700 disabled:opacity-60"
            >
              {info.notificationEnabled ? "通知を停止" : "通知を再開"}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              className="flex-1 rounded-lg border-2 border-red-300 py-2 text-sm font-bold text-red-700 disabled:opacity-60"
            >
              通知地点を削除
            </button>
          </div>
        </div>
      )}

      {errorMessage && <p className="mt-2 text-xs font-bold text-red-700">{errorMessage}</p>}
    </section>
  );
}
