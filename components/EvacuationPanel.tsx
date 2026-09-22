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
import Modal from "./ui/Modal";
import Button from "./ui/Button";
import Notice from "./ui/Notice";
import { ChevronLeftIcon, WarningIcon } from "./ui/icons";

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

const VIEW_TITLE: Record<View, string> = {
  candidates: "近くの洪水対応避難先",
  routes: "洪水の参考避難ルート",
  routeDetail: "ルート詳細",
};

export default function EvacuationPanel({
  position,
  onClose,
  onRoutesChange,
  onStartNavigation,
}: {
  position: LatLng;
  onClose: () => void;
  /** ルート一覧が変化するたびに呼ばれる。地図への描画はMapView側で行う。 */
  onRoutesChange: (
    data: { routes: WalkingRoute[]; highlightedIndex: number; destination: FloodShelterCandidate } | null
  ) => void;
  /** 試作3 PART A-1: 選択中のルートでナビを開始する（MapView側で画面を切り替える）。 */
  onStartNavigation: (route: WalkingRoute, destination: FloodShelterCandidate) => void;
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
    // candidatesLoadingはuseState(true)で既に初期値trueであり、このeffectは
    // マウント時に一度だけ実行される(依存配列は空)ため、ここで改めて
    // setCandidatesLoading(true)を呼ぶ必要はない(常にno-opだった)。
    let cancelled = false;
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
    <Modal
      onClose={handleClose}
      labelledBy="evacuation-panel-heading"
      leading={
        view !== "candidates" ? (
          <button
            type="button"
            onClick={() => setView(view === "routeDetail" ? "routes" : "candidates")}
            aria-label="前の画面に戻る"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)]"
          >
            <ChevronLeftIcon className="h-5 w-5" />
          </button>
        ) : undefined
      }
      title={view === "routeDetail" ? `${ROUTE_LABELS[selectedIndex] ?? "ルート"}について` : VIEW_TITLE[view]}
    >
      {view === "candidates" && (
        <div>
          <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
            大阪市が洪水時の指定緊急避難場所として指定している施設のうち、現在地から近い順に表示しています（直線距離）。
          </p>
          {candidatesLoading && (
            <p className="mt-4 flex items-center gap-2 text-[var(--color-text-secondary)]">
              <span
                className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
                aria-hidden
              />
              候補を検索しています…
            </p>
          )}
          {candidatesError && (
            <div className="mt-4">
              <Notice tone="danger" title="避難先候補を取得できませんでした">
                {candidatesError}
              </Notice>
            </div>
          )}
          <ul className="mt-3 space-y-2.5">
            {candidates?.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => handleSelectCandidate(c)}
                  className="w-full rounded-[var(--radius-md)] border-2 border-[var(--color-border)] p-3.5 text-left transition-colors hover:border-[var(--color-primary-border)] hover:bg-[var(--color-primary-surface)] active:bg-[var(--color-primary-surface)]"
                >
                  <div className="text-base font-bold text-[var(--color-text-primary)]">{c.name}</div>
                  <div className="mt-1 text-sm text-[var(--color-text-secondary)]">
                    直線距離：約{formatMeters(c.straightLineDistanceMeters)}
                  </div>
                  <div className="mt-1 text-sm text-[var(--color-info)]">大阪市の洪水対応指定あり</div>
                  <div className="mt-1 text-xs text-[var(--color-text-muted)]">{c.address}</div>
                  <div className="mt-2 text-sm font-bold text-[var(--color-primary)]">この避難先までのルートを見る →</div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {view === "routes" && (
        <div>
          {routingLoading && (
            <p className="flex items-center gap-2 text-[var(--color-text-secondary)]">
              <span
                className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
                aria-hidden
              />
              徒歩ルートを確認しています…
            </p>
          )}
          {hazardEvalLoading && (
            <p className="mt-2 flex items-center gap-2 text-[var(--color-text-secondary)]">
              <span
                className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
                aria-hidden
              />
              ルートの洪水ハザード情報を確認しています…
            </p>
          )}
          {routesError && (
            <div className="mt-2">
              <Notice tone="danger" title="ルートを取得できませんでした">
                {routesError}
              </Notice>
            </div>
          )}
          {routeResults && (
            <>
              <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
                {destination?.name} までの参考避難ルートです。洪水浸水想定区域を比較的少なく通るかどうかの目安として、各ルートの評価を独立して表示しています（自動で1つに絞り込んではいません）。
              </p>
              <ul className="mt-3 space-y-2.5">
                {routeResults.map((r, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => openRouteDetail(i)}
                      className="w-full rounded-[var(--radius-md)] border-2 border-[var(--color-border)] p-3.5 text-left transition-colors hover:border-[var(--color-primary-border)] hover:bg-[var(--color-primary-surface)] active:bg-[var(--color-primary-surface)]"
                    >
                      <div className="text-base font-bold text-[var(--color-text-primary)]">{ROUTE_LABELS[i] ?? `ルート${i + 1}`}</div>
                      <div className="mt-1 text-sm text-[var(--color-text-secondary)]">
                        {formatMeters(r.route.distanceMeters)}・{formatMinutes(r.route.durationSeconds)}
                      </div>
                      <div className="mt-1 text-sm text-[var(--color-text-secondary)]">{floodCrossingSummaryText(r.evaluation)}</div>
                      {r.evaluation.evaluatedDistanceMeters > 0 && (
                        <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                          最大想定浸水深：{DEPTH_RANK_LABELS[r.evaluation.maxDepthRank]}
                        </div>
                      )}
                      {r.evaluation.evaluationCoverageRatio !== null &&
                        r.evaluation.evaluationCoverageRatio > 0 &&
                        r.evaluation.evaluationCoverageRatio < 1 && (
                          <div className="mt-1.5 flex items-center gap-1 text-xs font-bold text-[var(--color-warning)]">
                            <WarningIcon className="h-3.5 w-3.5 shrink-0" />
                            ルートの一部でハザード情報を確認できていません（評価カバー率
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
        <div className="space-y-4">
          <section>
            <h3 className="text-sm font-bold text-[var(--color-text-primary)]">ルート情報</h3>
            <p className="mt-1 text-base text-[var(--color-text-primary)]">
              距離：約{formatMeters(routeLog.route.routingDistanceMeters)}
              <br />
              推定徒歩時間：{formatMinutes(routeLog.route.durationSeconds)}
            </p>
          </section>
          <section>
            <h3 className="text-sm font-bold text-[var(--color-text-primary)]">洪水ハザード評価（推定）</h3>
            {routeLog.floodHazard.evaluatedDistanceMeters === 0 ? (
              <p className="mt-1 text-base font-bold text-[var(--color-text-secondary)]">
                判定できません（このルートはハザード情報を確認できた区間がありませんでした）
              </p>
            ) : (
              <p className="mt-1 text-base text-[var(--color-text-primary)]">
                浸水想定区域を通る推定距離：約{formatMeters(routeLog.floodHazard.crossingDistanceMeters)}
                <br />
                割合（評価できた区間のうち）：{formatRatio(routeLog.floodHazard.crossingRatioAmongEvaluatedDistance)}
                <br />
                最大想定浸水深：{DEPTH_RANK_LABELS[routeLog.floodHazard.maxDepthRank]}
              </p>
            )}

            <div className="mt-3 rounded-[var(--radius-md)] bg-[var(--color-surface-subtle)] p-3">
              <div className="text-sm font-bold text-[var(--color-text-primary)]">評価カバー率</div>
              <div className="mt-1 text-base text-[var(--color-text-primary)]">
                {formatRatio(routeLog.floodHazard.evaluationCoverageRatio)}
                （評価済み 約{formatMeters(routeLog.floodHazard.evaluatedDistanceMeters)} / ハザード評価対象距離 約
                {formatMeters(routeLog.floodHazard.hazardEvaluationDistanceMeters)}）
              </div>
              <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                ※ハザード評価対象距離は、ルート距離（約
                {formatMeters(routeLog.route.routingDistanceMeters)}）とは別に、経路の形状から独自に算出した道なり距離です。ごくわずかな差が生じる場合があります。
              </div>
              {routeLog.floodHazard.unavailableDistanceMeters > 0 && (
                <div className="mt-2 flex items-center gap-1 text-sm font-bold text-[var(--color-warning)]">
                  <WarningIcon className="h-4 w-4 shrink-0" />
                  ルートの一部でハザード情報を確認できていません（未評価：約
                  {formatMeters(routeLog.floodHazard.unavailableDistanceMeters)}、
                  {routeLog.floodHazard.unavailableSampleCount}地点）。この区間は「安全」を意味するものではありません。
                </div>
              )}
            </div>

            <p className="mt-2 text-xs leading-relaxed text-[var(--color-text-muted)]">
              約{routeLog.sampling.intervalMeters}mごと・{routeLog.sampling.sampleCount}
              地点のサンプリングによる推定値です（処理時間：約{routeLog.sampling.processingTimeMs}ms）。
              実際の浸水区域の境界と厳密には一致しない場合があります。サンプル地点の間に狭い浸水域がある場合、見逃す可能性があります。
            </p>
          </section>
          <section className="rounded-[var(--radius-md)] bg-[var(--color-surface-subtle)] p-3">
            <h3 className="text-sm font-bold text-[var(--color-text-primary)]">データについて</h3>
            <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
              大阪市の洪水対応指定：あり（国土地理院データ）
              <br />
              使用ハザードデータ：ハザードマップポータルサイト（洪水浸水想定区域）
              <br />
              評価時刻：{new Date(routeLog.judgedAt).toLocaleString("ja-JP")}
            </p>
          </section>
          <section className="border-t border-[var(--color-border)] pt-3">
            <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
              ※これは「参考避難ルート」であり、「安全なルート」であることを保証するものではありません。冠水・通行止め・倒木・工事・火災・混雑など、実際の道路状況はリアルタイムに反映されていません。現地の状況を優先してください。
            </p>
          </section>
          {/* 試作3 PART A-1: 選択したルートのgeometryをそのまま使ってナビを
              開始する（ここで別ルートへ再計算することはしない）。 */}
          <Button
            onClick={() => {
              const r = routeResults?.[selectedIndex];
              if (r && destination) onStartNavigation(r.route, destination);
            }}
            fullWidth
            size="lg"
          >
            このルートで案内を開始
          </Button>
          <Button onClick={() => setView("routes")} variant="secondary" fullWidth>
            ルート一覧に戻る
          </Button>
        </div>
      )}
    </Modal>
  );
}
