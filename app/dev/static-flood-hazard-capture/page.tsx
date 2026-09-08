"use client";

// 試作3 要件定義書3 §71〜73 PART E・K: staticFloodHazard方式Bの開発用確認ページ。
//
// 【重要・方式Bの核心】ここでは新しい洪水判定アルゴリズムを一切作らない。
// 既存のlib/hazardPixelClassifier.ts（本番の現在地判定・ルート評価と同じ、
// 検証済みのモジュール）をブラウザ上でそのまま呼び出し、その結果を
// 研究用固定JSON(scripts/research-data/static-flood-hazard-points.json)として
// 保存する(PART B)。本番Firebase監視用のツールではない。
//
// 大規模UIは不要という方針(PART K)のため、確認できれば十分な
// 簡易テーブル + JSON保存ボタンのみで構成する。
// このページはNEXT_PUBLIC_ENABLE_DEV_TOOLS=1の場合のみ利用を想定する
// (DevNotificationTesterと同じ方針。一般ユーザー向けUIには組み込まない)。

import { useState } from "react";
import { classifyHazardPixel, type HazardPixelStatus } from "@/lib/hazardPixelClassifier";
import { HAZARD_TILE_URL } from "@/components/hazardLayers";
import {
  toStaticFloodHazardPointResult,
  toCaptureFailurePointResult,
  type StaticFloodHazardPointResult,
  type ResearchMonitoringPoint,
} from "@/lib/staticFloodHazardCapture";

type RowState = StaticFloodHazardPointResult & { label?: string };

const STATUS_LABEL: Record<StaticFloodHazardPointResult["floodStatus"], string> = {
  hazard: "🌊 hazard（想定区域内）",
  outside: "○ outside（区域外・透明ピクセル）",
  unknown: "⚪ unknown（判定できず）",
};

export default function StaticFloodHazardCapturePage() {
  const [points, setPoints] = useState<ResearchMonitoringPoint[] | null>(null);
  const [rows, setRows] = useState<RowState[]>([]);
  const [status, setStatus] = useState<"idle" | "loading-points" | "capturing" | "saving" | "done" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  if (process.env.NEXT_PUBLIC_ENABLE_DEV_TOOLS !== "1") {
    return (
      <main className="p-6 text-sm text-zinc-600">
        この開発用ページは無効化されています(NEXT_PUBLIC_ENABLE_DEV_TOOLS=1で有効化)。
      </main>
    );
  }

  const loadPoints = async () => {
    setStatus("loading-points");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/dev/research-monitoring-points");
      if (!res.ok) throw new Error(`研究地点入力の取得に失敗しました(HTTP ${res.status})`);
      const data = (await res.json()) as { points: ResearchMonitoringPoint[] };
      setPoints(data.points);
      setStatus("idle");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const runCapture = async () => {
    if (!points) return;
    setStatus("capturing");
    setErrorMessage(null);
    const nowMeta = { evaluatedAt: "", systemVersion: "", gitCommit: "" }; // サーバー側で保存時に確定させる(表示専用の暫定値)

    const results: RowState[] = [];
    for (const point of points) {
      try {
        // 【PART A】既存の本番判定ロジックをそのまま呼び出す。洪水(flood)のみが対象
        // (notificationDecisionConfig.targetHazard="flood"、要件定義書3 §4に合わせる)。
        const pixel: HazardPixelStatus = await classifyHazardPixel(
          HAZARD_TILE_URL.flood,
          point.latitude,
          point.longitude
        );
        results.push({ ...toStaticFloodHazardPointResult(point, pixel, nowMeta), label: point.pointId });
      } catch {
        // PART G: 例外が起きても地点を消さず、unknownとして残す。
        results.push({ ...toCaptureFailurePointResult(point, nowMeta), label: point.pointId });
      }
      setRows([...results]);
    }
    setStatus("idle");
  };

  const save = async () => {
    if (rows.length === 0) return;
    setStatus("saving");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/dev/static-flood-hazard-capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          points: rows.map((r) => ({
            pointId: r.pointId,
            latitude: r.latitude,
            longitude: r.longitude,
            technicalVerificationOnly: r.technicalVerificationOnly,
            pixel:
              r.floodStatus === "hazard"
                ? { status: "hazard", rank: r.depthRank }
                : r.floodStatus === "outside"
                  ? { status: "outside" }
                  : { status: "unknown", reason: r.floodStatusReason ?? "other" },
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `保存に失敗しました(HTTP ${res.status})`);
      setSavedPath(data.outputPath);
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <main className="mx-auto max-w-3xl p-6 text-sm text-zinc-800">
      <h1 className="text-lg font-bold">staticFloodHazard方式B: Hazard Capture（開発用）</h1>
      <p className="mt-2 text-zinc-600">
        研究用地点について、既存のブラウザ洪水判定(lib/hazardPixelClassifier.ts)をそのまま実行し、
        結果を研究用固定JSONへ保存します。本番Firebase監視用ではなく、Notification Backtest研究専用です。
      </p>
      <p className="mt-1 text-xs text-amber-700">
        ここで扱う地点は本実験地点ではありません(scripts/research-data/research-monitoring-points.json参照)。
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className="rounded-lg border-2 border-zinc-300 px-3 py-1.5 disabled:opacity-50"
          onClick={loadPoints}
          disabled={status === "loading-points"}
        >
          1. 研究地点入力を読み込む
        </button>
        <button
          className="rounded-lg border-2 border-zinc-300 px-3 py-1.5 disabled:opacity-50"
          onClick={runCapture}
          disabled={!points || status === "capturing"}
        >
          2. 既存判定を実行
        </button>
        <button
          className="rounded-lg border-2 border-zinc-300 px-3 py-1.5 disabled:opacity-50"
          onClick={save}
          disabled={rows.length === 0 || status === "saving"}
        >
          3. 固定JSONとして保存
        </button>
      </div>

      {errorMessage && <p className="mt-3 text-red-700">エラー: {errorMessage}</p>}
      {status === "done" && savedPath && <p className="mt-3 text-green-700">保存しました: {savedPath}</p>}

      {rows.length > 0 && (
        <table className="mt-4 w-full border-collapse text-xs">
          <thead>
            <tr className="border-b text-left">
              <th className="p-1">Point</th>
              <th className="p-1">Coordinates</th>
              <th className="p-1">Flood status</th>
              <th className="p-1">Depth</th>
              <th className="p-1">Completeness</th>
              <th className="p-1">Reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.pointId} className="border-b">
                <td className="p-1">{r.pointId}</td>
                <td className="p-1">
                  {r.latitude.toFixed(4)}, {r.longitude.toFixed(4)}
                </td>
                <td className="p-1">{STATUS_LABEL[r.floodStatus]}</td>
                <td className="p-1">{r.expectedDepthLabel ?? "-"}</td>
                <td className="p-1">{r.assessmentCompleteness}</td>
                <td className="p-1">{r.floodStatusReason ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
