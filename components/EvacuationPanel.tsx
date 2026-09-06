"use client";

import { useEffect, useState } from "react";
import {
  findFloodShelterCandidates,
  type FloodShelterCandidate,
} from "@/lib/floodShelterCandidates";
import { fetchWalkingRoutes, type WalkingRoute } from "@/lib/evacuationRoute";
import {
  evaluateRouteFloodHazard,
  DEFAULT_SAMPLE_INTERVAL_METERS,
  type RouteHazardEvaluation,
  type LatLng,
} from "@/lib/routeHazardEvaluation";
import { buildRouteJudgmentLog, type RouteJudgmentLog } from "@/lib/routeJudgmentLog";

type RouteWithEvaluation = {
  route: WalkingRoute;
  evaluation: RouteHazardEvaluation;
};

type View = "candidates" | "routes" | "routeDetail";

const ROUTE_LABELS = ["ルートA", "ルートB", "ルートC"];

function formatMinutes(seconds: number): string {
  return `徒歩${Math.max(1, Math.round(seconds / 60))}分`;
}

function formatMeters(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`;
}

function formatRatio(r: number | null): string {
  if (r === null) return "評価不可";
  return `約${(r * 100).toFixed(1)}%`;
}

// Coverageが0%（＝この区間について何も判定できていない）の場合、
// 「洪水区域0%」のように安全側の数値として見えないよう、専用の文言にする。
function floodCrossingSummaryText(evaluation: RouteHazardEvaluation): string {
  if (evaluation.evaluatedDistanceMeters === 0) {
    return "洪水ハザード評価：判定できません（ハザード情報を確認できた区間がありませんでした）";
  }
  return `浸水想定区域を通る距離の目安：${formatMeters(evaluation.floodCrossingDistanceMeters)}（${formatRatio(
    evaluation.floodCrossingRatioAmongEvaluatedDistance
  )}）`;
}

const DEPTH_RANK_LABELS: Record<number, string> = {
  0: "検出なし",
  1: "0.5m未満",
  2: "0.5m〜3.0m",
  3: "3.0m〜5.0m",
  4: "5.0m〜10.0m",
  5: "10.0m以上",
};

export default function EvacuationPanel({
  position,
  onClose,
  onRoutesChange,
}: {
  position: LatLng;
  onClose: () => void;
  /** ルート一覧が変化するたびに呼ばれる。地図への描画はMapView側で行う。 */
  onRoutesChange: (
    data: { routes: WalkingRoute[]; highlightedIndex: number; destination: FloodShelterCandidate } | null
  ) => void;
}) {
  const [view, setView] = useState<View>("candidates");

  const [candidates, setCandidates] = useState<FloodShelterCandidate[] | null>(null);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [candidatesLoading, setCandidatesLoading] = useState(true);

  const [destination, setDestination] = useState<FloodShelterCandidate | null>(null);
  // ルート取得とハザード評価は別工程のため、ユーザーに「今なにをしているか」が
  // 伝わるよう、ローディング状態を分けて管理する。
  const [routingLoading, setRoutingLoading] = useState(false);
  const [hazardEvalLoading, setHazardEvalLoading] = useState(false);
  const [routesError, setRoutesError] = useState<string | null>(null);
  const [routeResults, setRouteResults] = useState<RouteWithEvaluation[] | null>(null);
  // 同じ避難先への重複リクエストを防ぐ（連打・再選択時の二重取得を避ける）
  const [requestedDestinationId, setRequestedDestinationId] = useState<string | null>(null);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [routeLog, setRouteLog] = useState<RouteJudgmentLog | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCandidatesLoading(true);
    findFloodShelterCandidates(position).then((result) => {
      if (cancelled) return;
      setCandidatesLoading(false);
      if (result.status === "fetch_error") {
        setCandidatesError("避難場所データを取得できませんでした。通信環境をご確認ください。");
      } else if (result.candidates.length === 0) {
        setCandidatesError("近くに大阪市指定の洪水対応避難場所が見つかりませんでした。");
      } else {
        setCandidates(result.candidates);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (routeResults) {
      onRoutesChange({
        routes: routeResults.map((r) => r.route),
        highlightedIndex: selectedIndex,
        destination: destination!,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeResults, selectedIndex]);

  const handleSelectCandidate = async (candidate: FloodShelterCandidate) => {
    // 同じ避難先へのリクエストが既に進行中/完了済みなら、ビューだけ切り替えて再取得しない
    if (requestedDestinationId === candidate.id && (routingLoading || hazardEvalLoading || routeResults)) {
      setView("routes");
      return;
    }
    setRequestedDestinationId(candidate.id);
    setDestination(candidate);
    setView("routes");
    setRoutingLoading(true);
    setRoutesError(null);
    setRouteResults(null);

    const fetchResult = await fetchWalkingRoutes(position, {
      lat: candidate.lat,
      lng: candidate.lng,
    });
    setRoutingLoading(false);

    if (fetchResult.status === "error") {
      setRoutesError(fetchResult.message);
      return;
    }

    setHazardEvalLoading(true);
    const withEval = await Promise.all(
      fetchResult.routes.map(async (route) => ({
        route,
        evaluation: await evaluateRouteFloodHazard(route.geometry, DEFAULT_SAMPLE_INTERVAL_METERS),
      }))
    );

    setRouteResults(withEval);
    setSelectedIndex(0);
    setHazardEvalLoading(false);
  };

  const handleClose = () => {
    // パネルを閉じても、既に取得済みのルートは地図上に表示したままにする
    // （ユーザーが地図を確認できるようにするため。ルート表示は「避難先を
    // 探す」から新しく検索し直したときにのみ更新される）。
    onClose();
  };

  const openRouteDetail = (index: number) => {
    setSelectedIndex(index);
    const r = routeResults?.[index];
    if (r && destination) {
      setRouteLog(
        buildRouteJudgmentLog({
          origin: position,
          destination,
          provider: "openrouteservice",
          routingDistanceMeters: r.route.distanceMeters,
          durationSeconds: r.route.durationSeconds,
          geometryPointCount: r.route.geometry.length,
          evaluation: r.evaluation,
        })
      );
    }
    setView("routeDetail");
  };

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-end sm:items-center sm:justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      onClick={handleClose}
    >
      <div
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {view !== "candidates" && (
              <button
                type="button"
                onClick={() => setView(view === "routeDetail" ? "routes" : "candidates")}
                aria-label="前の画面に戻る"
                className="shrink-0 rounded-full border-2 border-zinc-300 px-3 py-1 text-lg font-bold text-zinc-600"
              >
                ←
              </button>
            )}
            <h2 className="truncate text-lg font-bold text-zinc-900">
              {view === "candidates" && "近くの洪水対応避難先"}
              {view === "routes" && "洪水の参考避難ルート"}
              {view === "routeDetail" && `${ROUTE_LABELS[selectedIndex]}について`}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="閉じる"
            className="shrink-0 rounded-full border-2 border-zinc-300 px-3 py-1 text-lg font-bold text-zinc-600"
          >
            ×
          </button>
        </div>

        {view === "candidates" && (
          <div className="mt-3">
            <p className="text-xs text-zinc-500">
              大阪市が洪水時の指定緊急避難場所として指定している施設のうち、現在地から近い順に表示しています（直線距離）。
            </p>
            {candidatesLoading && <p className="mt-4 text-zinc-600">候補を検索しています…</p>}
            {candidatesError && (
              <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{candidatesError}</p>
            )}
            <ul className="mt-3 space-y-2">
              {candidates?.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => handleSelectCandidate(c)}
                    className="w-full rounded-lg border-2 border-zinc-300 p-3 text-left active:bg-zinc-50"
                  >
                    <div className="text-base font-bold text-zinc-900">{c.name}</div>
                    <div className="mt-1 text-sm text-zinc-600">
                      直線距離：約{formatMeters(c.straightLineDistanceMeters)}
                    </div>
                    <div className="mt-1 text-sm text-blue-700">大阪市の洪水対応指定あり</div>
                    <div className="mt-1 text-xs text-zinc-500">{c.address}</div>
                    <div className="mt-2 text-sm font-bold text-emerald-700">この避難先までのルートを見る →</div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {view === "routes" && (
          <div className="mt-3">
            {routingLoading && <p className="text-zinc-600">徒歩ルートを確認しています…</p>}
            {hazardEvalLoading && (
              <p className="text-zinc-600">ルートの洪水ハザード情報を確認しています…</p>
            )}
            {routesError && (
              <p className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">{routesError}</p>
            )}
            {routeResults && (
              <>
                <p className="text-xs text-zinc-500">
                  {destination?.name} までの参考避難ルートです。洪水浸水想定区域を比較的少なく通るかどうかの目安として、各ルートの評価を独立して表示しています（自動で1つに絞り込んではいません）。
                </p>
                <ul className="mt-3 space-y-2">
                  {routeResults.map((r, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => openRouteDetail(i)}
                        className="w-full rounded-lg border-2 border-zinc-300 p-3 text-left active:bg-zinc-50"
                      >
                        <div className="text-base font-bold text-zinc-900">{ROUTE_LABELS[i] ?? `ルート${i + 1}`}</div>
                        <div className="mt-1 text-sm text-zinc-700">
                          {formatMeters(r.route.distanceMeters)}・{formatMinutes(r.route.durationSeconds)}
                        </div>
                        <div className="mt-1 text-sm text-zinc-700">{floodCrossingSummaryText(r.evaluation)}</div>
                        {r.evaluation.evaluatedDistanceMeters > 0 && (
                          <div className="mt-1 text-xs text-zinc-500">
                            最大想定浸水深：{DEPTH_RANK_LABELS[r.evaluation.maxDepthRank]}
                          </div>
                        )}
                        {r.evaluation.evaluationCoverageRatio !== null &&
                          r.evaluation.evaluationCoverageRatio > 0 &&
                          r.evaluation.evaluationCoverageRatio < 1 && (
                            <div className="mt-1 text-xs font-bold text-amber-700">
                              ⚠ ルートの一部でハザード情報を確認できていません（評価カバー率
                              {formatRatio(r.evaluation.evaluationCoverageRatio)}）
                            </div>
                          )}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {view === "routeDetail" && routeLog && (
          <div className="mt-3 space-y-4">
            <section>
              <h3 className="text-sm font-bold text-zinc-900">【ルート情報】</h3>
              <p className="mt-1 text-base text-zinc-800">
                距離：約{formatMeters(routeLog.route.routingDistanceMeters)}
                <br />
                推定徒歩時間：{formatMinutes(routeLog.route.durationSeconds)}
              </p>
            </section>
            <section>
              <h3 className="text-sm font-bold text-zinc-900">【洪水ハザード評価（推定）】</h3>
              {routeLog.floodHazard.evaluatedDistanceMeters === 0 ? (
                <p className="mt-1 text-base font-bold text-zinc-700">
                  判定できません（このルートはハザード情報を確認できた区間がありませんでした）
                </p>
              ) : (
                <p className="mt-1 text-base text-zinc-800">
                  浸水想定区域を通る推定距離：約{formatMeters(routeLog.floodHazard.crossingDistanceMeters)}
                  <br />
                  割合（評価できた区間のうち）：{formatRatio(routeLog.floodHazard.crossingRatioAmongEvaluatedDistance)}
                  <br />
                  最大想定浸水深：{DEPTH_RANK_LABELS[routeLog.floodHazard.maxDepthRank]}
                </p>
              )}

              <div className="mt-3 rounded-lg bg-zinc-50 p-3">
                <div className="text-sm font-bold text-zinc-800">評価カバー率</div>
                <div className="mt-1 text-base text-zinc-800">
                  {formatRatio(routeLog.floodHazard.evaluationCoverageRatio)}
                  （評価済み 約{formatMeters(routeLog.floodHazard.evaluatedDistanceMeters)} / ハザード評価対象距離 約
                  {formatMeters(routeLog.floodHazard.hazardEvaluationDistanceMeters)}）
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  ※ハザード評価対象距離は、ルート距離（約
                  {formatMeters(routeLog.route.routingDistanceMeters)}）とは別に、経路の形状から独自に算出した道なり距離です。ごくわずかな差が生じる場合があります。
                </div>
                {routeLog.floodHazard.unavailableDistanceMeters > 0 && (
                  <div className="mt-1 text-sm font-bold text-amber-700">
                    ⚠ ルートの一部でハザード情報を確認できていません（未評価：約
                    {formatMeters(routeLog.floodHazard.unavailableDistanceMeters)}、
                    {routeLog.floodHazard.unavailableSampleCount}地点）。この区間は「安全」を意味するものではありません。
                  </div>
                )}
              </div>

              <p className="mt-2 text-xs text-zinc-500">
                約{routeLog.sampling.intervalMeters}mごと・{routeLog.sampling.sampleCount}
                地点のサンプリングによる推定値です（処理時間：約{routeLog.sampling.processingTimeMs}ms）。
                実際の浸水区域の境界と厳密には一致しない場合があります。サンプル地点の間に狭い浸水域がある場合、見逃す可能性があります。
              </p>
            </section>
            <section className="rounded-lg bg-zinc-50 p-3">
              <h3 className="text-sm font-bold text-zinc-900">【データについて】</h3>
              <p className="mt-1 text-xs text-zinc-600">
                大阪市の洪水対応指定：あり（国土地理院データ）
                <br />
                使用ハザードデータ：ハザードマップポータルサイト（洪水浸水想定区域）
                <br />
                評価時刻：{new Date(routeLog.judgedAt).toLocaleString("ja-JP")}
              </p>
            </section>
            <section className="border-t border-zinc-200 pt-3">
              <p className="text-xs leading-relaxed text-zinc-500">
                ※これは「参考避難ルート」であり、「安全なルート」であることを保証するものではありません。冠水・通行止め・倒木・工事・火災・混雑など、実際の道路状況はリアルタイムに反映されていません。現地の状況を優先してください。
              </p>
            </section>
            <button
              type="button"
              onClick={() => setView("routes")}
              className="w-full rounded-lg border-2 border-zinc-300 py-2 text-base font-bold text-zinc-700"
            >
              ルート一覧に戻る
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
