"use client";

// 要件定義書3 docs/research-location-sampling-design.md §11: candidate population
// （洪水対応指定緊急避難場所データ）全数を、既存の洪水ハザード判定
// (lib/hazardPixelClassifier.ts、既存・検証済み。変更なし)でそのまま分類する開発用ページ。
//
// 【重要】ここでの分類は「本実験地点をhazard/outside/unknownへ機械的に仕分ける」
// ためだけの処理であり、個々の地点を目視で選ぶものではない。分類結果を見てから
// 都合よく選ぶ操作はこのページでは行わない(次段階のseed固定random samplingが選ぶ)。
//
// タイルサーバーへの配慮のため、同一タイルURLへの重複fetchをこのページ内だけで
// メモ化する(判定ロジック自体は一切変更しない。ネットワーク層の最適化のみ)。

import { useState } from "react";
import { classifyHazardPixel, type HazardPixelStatus } from "@/lib/hazardPixelClassifier";
import { HAZARD_TILE_URL } from "@/components/hazardLayers";

type Candidate = { id: string; latitude: number; longitude: number; ward: string; name: string };
type Provenance = Record<string, unknown>;

type ResultRow = Candidate & { pixel?: HazardPixelStatus; captureFailed?: boolean };

export default function CandidatePopulationClassificationPage() {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [provenance, setProvenance] = useState<Provenance | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<"idle" | "loading" | "classifying" | "saving" | "done" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ hazardCount: number; outsideCount: number; unknownCount: number } | null>(
    null
  );
  const resultsRef = { current: [] as ResultRow[] };

  if (process.env.NEXT_PUBLIC_ENABLE_DEV_TOOLS !== "1") {
    return (
      <main className="p-6 text-sm text-zinc-600">
        この開発用ページは無効化されています(NEXT_PUBLIC_ENABLE_DEV_TOOLS=1で有効化)。
      </main>
    );
  }

  const loadCandidates = async () => {
    setStatus("loading");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/dev/candidate-population");
      if (!res.ok) throw new Error(`candidate populationの取得に失敗しました(HTTP ${res.status})`);
      const data = (await res.json()) as { candidates: Candidate[]; provenance: Provenance };
      setCandidates(data.candidates);
      setProvenance(data.provenance);
      setStatus("idle");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const runClassification = async () => {
    if (!candidates) return;
    setStatus("classifying");
    setErrorMessage(null);
    setProgress(0);

    // タイルサーバーへの配慮: 同一タイルURLの重複fetchだけをメモ化する
    // (判定内容には一切影響しない。純粋なネットワーク最適化)。
    const originalFetch = window.fetch.bind(window);
    const tileCache = new Map<string, Response>();
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("disaportaldata.gsi.go.jp") && tileCache.has(url)) {
        return tileCache.get(url)!.clone();
      }
      const res = await originalFetch(input, init);
      if (url.includes("disaportaldata.gsi.go.jp") && res.ok) {
        tileCache.set(url, res.clone());
      }
      return res;
    };

    const results: ResultRow[] = [];
    try {
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        try {
          const pixel = await classifyHazardPixel(HAZARD_TILE_URL.flood, c.latitude, c.longitude);
          results.push({ ...c, pixel });
        } catch {
          results.push({ ...c, captureFailed: true });
        }
        if (i % 20 === 0 || i === candidates.length - 1) {
          setProgress(i + 1);
        }
      }
    } finally {
      window.fetch = originalFetch;
    }

    resultsRef.current = results;
    setSummary({
      hazardCount: results.filter((r) => r.pixel?.status === "hazard").length,
      outsideCount: results.filter((r) => r.pixel?.status === "outside").length,
      unknownCount: results.filter((r) => !r.pixel || r.pixel.status === "unknown" || r.captureFailed).length,
    });
    (window as unknown as { __candidateClassificationResults?: ResultRow[] }).__candidateClassificationResults =
      results;
    setStatus("idle");
  };

  const save = async () => {
    const results = (window as unknown as { __candidateClassificationResults?: ResultRow[] })
      .__candidateClassificationResults;
    if (!results || results.length === 0) return;
    setStatus("saving");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/dev/candidate-population-classification", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ results, provenance }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `保存に失敗しました(HTTP ${res.status})`);
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <main className="mx-auto max-w-3xl p-6 text-sm text-zinc-800">
      <h1 className="text-lg font-bold">Candidate Population 機械分類（開発用）</h1>
      <p className="mt-2 text-zinc-600">
        洪水対応指定緊急避難場所データ全数を、既存の洪水ハザード判定でhazard/outside/unknownへ機械的に分類します。
        本実験地点のseed固定random samplingの入力にするためのものであり、個々の地点を目視で選ぶものではありません。
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className="rounded-lg border-2 border-zinc-300 px-3 py-1.5 disabled:opacity-50"
          onClick={loadCandidates}
          disabled={status === "loading"}
        >
          1. candidate populationを読み込む
        </button>
        <button
          className="rounded-lg border-2 border-zinc-300 px-3 py-1.5 disabled:opacity-50"
          onClick={runClassification}
          disabled={!candidates || status === "classifying"}
        >
          2. 全数を機械分類する
        </button>
        <button
          className="rounded-lg border-2 border-zinc-300 px-3 py-1.5 disabled:opacity-50"
          onClick={save}
          disabled={!summary || status === "saving"}
        >
          3. 分類結果を保存する
        </button>
      </div>

      {candidates && <p className="mt-3">candidate population: {candidates.length}件</p>}
      {status === "classifying" && (
        <p className="mt-3">
          分類中: {progress} / {candidates?.length ?? "?"}
        </p>
      )}
      {summary && (
        <p className="mt-3">
          hazard: {summary.hazardCount} / outside: {summary.outsideCount} / unknown: {summary.unknownCount}
        </p>
      )}
      {errorMessage && <p className="mt-3 text-red-700">エラー: {errorMessage}</p>}
      {status === "done" && (
        <p className="mt-3 text-green-700">保存しました: scripts/research-data/candidate-population-classification.json</p>
      )}
    </main>
  );
}
