"use client";

import { useEffect, useRef, useState } from "react";
import {
  findFloodShelterCandidates,
  type FloodShelterCandidate,
} from "@/lib/floodShelterCandidates";
import type { PrefectureCode } from "@/lib/region/types";
import { PREFECTURE_NAMES } from "@/lib/region/types";
import type { ShelterSearchScope } from "@/lib/shelter/crossPrefectureSearch";
import type { ShelterDataCompleteness } from "@/lib/shelter/dataCompleteness";
import { fetchWalkingRoutes, type WalkingRoute } from "@/lib/evacuationRoute";
import {
  evaluateRouteFloodHazard,
  DEFAULT_SAMPLE_INTERVAL_METERS,
  type RouteHazardEvaluation,
  type LatLng,
} from "@/lib/routeHazardEvaluation";
import { buildRouteJudgmentLog, type RouteJudgmentLog } from "@/lib/routeJudgmentLog";
import { evaluateRouteSegmentRisk, type RouteRiskSegment } from "@/lib/routeSegmentRisk";
import Modal from "./ui/Modal";
import Button from "./ui/Button";
import Notice from "./ui/Notice";
import ShelterDetailContent from "./ShelterDetailContent";
import RouteRiskLegend from "./RouteRiskLegend";
import RouteRiskDetail from "./RouteRiskDetail";
import { toHazardLabels } from "./hazardLayers";
import { ROUTE_RISK_LEVEL_PRESENTATION } from "./routeRiskPresentation";
import { ChevronLeftIcon, WarningIcon } from "./ui/icons";

type RouteWithEvaluation = {
  route: WalkingRoute;
  evaluation: RouteHazardEvaluation;
};

type View = "candidates" | "routes" | "routeDetail" | "shelterDetail";

const ROUTE_LABELS = ["ルートA", "ルートB", "ルートC"];

function formatMinutes(seconds: number): string {
  return `徒歩${Math.max(1, Math.round(seconds / 60))}分`;
}

function formatMeters(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`;
}

/** 候補カードの所在地表示（例:「奈良県 生駒市」）。元データに無ければ府県名のみ。 */
function formatCandidateLocation(c: FloodShelterCandidate): string {
  return [c.prefectureName ?? PREFECTURE_NAMES[c.prefectureCode], c.municipalityName].filter(Boolean).join(" ");
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
  shelterDetail: "避難先の詳細",
};

export default function EvacuationPanel({
  position,
  searchScope,
  shelterDataCompleteness,
  onCandidatesChange,
  onClose,
  onRoutesChange,
  onStartNavigation,
  initialDestination = null,
}: {
  position: LatLng;
  /** 地図上の避難所マーカーの吹き出しから開いた場合の行き先。指定されていれば、
   *  候補一覧ではなく、その避難所へのルート比較画面から表示する（戻るボタンで
   *  候補一覧も見られる）。 */
  initialDestination?: FloodShelterCandidate | null;
  /** Phase 6 PART B: 避難先候補の検索対象府県（lib/shelter/crossPrefectureSearch.ts）。
   *  nullの場合（近畿外・地域を判定できない等）は、避難所データを誤って流用せず、
   *  「準備中」であることを案内する（データ取得自体を行わない）。 */
  searchScope: ShelterSearchScope | null;
  /** Phase 6 PART D: 現在地の市区町村の公式避難所データ提供状況。 */
  shelterDataCompleteness: ShelterDataCompleteness;
  /** Phase 6 PART B: 候補一覧が確定したら呼ばれる（地図上の隣接府県候補の表示用）。 */
  onCandidatesChange: (candidates: FloodShelterCandidate[]) => void;
  onClose: () => void;
  /** ルート一覧が変化するたびに呼ばれる。地図への描画はMapView側で行う。
   *  riskSegmentsは選択中ルートの区間別リスク評価(DEM＋洪水)。
   *  未評価/評価中/取得失敗の場合はnull(地図側は従来の単色ルート表示のままにする)。 */
  onRoutesChange: (
    data: {
      routes: WalkingRoute[];
      highlightedIndex: number;
      destination: FloodShelterCandidate;
      riskSegments?: RouteRiskSegment[] | null;
    } | null
  ) => void;
  /** 試作3 PART A-1: 選択中のルートでナビを開始する（MapView側で画面を切り替える）。 */
  onStartNavigation: (route: WalkingRoute, destination: FloodShelterCandidate) => void;
}) {
  const [view, setView] = useState<View>(initialDestination ? "routes" : "candidates");

  // 地域判定基盤（Phase 2/3）: 現在地が避難所データ対応地域でない場合（近畿外等）。
  // searchScopeはpropsであり、このパネルが開いている間に変化しない
  // 前提のため、stateではなく素の派生値として扱う（不要なeffect/setStateを避ける）。
  // candidatesError（取得失敗）とは意味が異なるため別のNoticeにする
  // （「準備中」を「エラー」のように見せない）。
  const candidatesUnsupported = searchScope === null;

  const [candidates, setCandidates] = useState<FloodShelterCandidate[] | null>(null);
  // Phase 6 PART B: 取得に失敗した隣接府県（現在府県の候補は表示できている場合）。
  const [failedNeighborPrefectures, setFailedNeighborPrefectures] = useState<PrefectureCode[]>([]);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [candidatesLoading, setCandidatesLoading] = useState(!candidatesUnsupported);

  const [destination, setDestination] = useState<FloodShelterCandidate | null>(initialDestination);
  // ルート取得とハザード評価は別工程のため、ユーザーに「今なにをしているか」が
  // 伝わるよう、ローディング状態を分けて管理する。
  const [routingLoading, setRoutingLoading] = useState(initialDestination !== null);
  const [hazardEvalLoading, setHazardEvalLoading] = useState(false);
  const [routesError, setRoutesError] = useState<string | null>(null);
  const [routeResults, setRouteResults] = useState<RouteWithEvaluation[] | null>(null);
  // 同じ避難先への重複リクエストを防ぐ（連打・再選択時の二重取得を避ける）
  const [requestedDestinationId, setRequestedDestinationId] = useState<string | null>(initialDestination?.id ?? null);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [routeLog, setRouteLog] = useState<RouteJudgmentLog | null>(null);

  // 避難所詳細情報の拡充: 候補一覧から個別の詳細を確認するための状態。
  // EvacuationPanel自体のview(candidates/routes/routeDetail)とは独立させ、
  // 既存のビュー遷移ロジックには手を加えない(詳細モーダルは重ねて開くだけ)。
  const [detailShelter, setDetailShelter] = useState<FloodShelterCandidate | null>(null);

  // DEM標高＋洪水による区間別リスク評価(routeDetailを開いた時だけ実行)。
  // 【重要】既存のルート取得・ハザード評価(routeResults)には一切影響しない
  // 付加情報。失敗してもルート表示自体は壊さない。
  const [segmentRisk, setSegmentRisk] = useState<RouteRiskSegment[] | null>(null);
  const [segmentRiskLoading, setSegmentRiskLoading] = useState(false);
  const [segmentRiskError, setSegmentRiskError] = useState<string | null>(null);
  const [expandedSegmentIndex, setExpandedSegmentIndex] = useState<number | null>(null);
  // ルートA→すぐルートBのように切り替えた場合、古い評価が後から返ってきて
  // 新しい結果を上書きしないようにするためのrequest-idパターン
  // (findFloodShelterCandidates等で使っているcancelledフラグと同じ考え方だが、
  // イベントハンドラ(openRouteDetail)から呼ぶためuseEffectのcleanupが使えず、refで代用する)。
  const segmentRiskRequestIdRef = useRef(0);

  useEffect(() => {
    // candidatesLoadingはuseState(true)で既に初期値trueであり、このeffectは
    // マウント時に一度だけ実行される(依存配列は空)ため、ここで改めて
    // setCandidatesLoading(true)を呼ぶ必要はない(常にno-opだった)。
    // 地域判定基盤（Phase 2/3）: この地域の避難所データが無い場合
    // （近畿外等）、他府県の避難所データを誤って取得・表示しない。
    // 取得自体を行わない（candidatesUnsupportedは上でcandidatesLoadingの
    // 初期値にも反映済み）。
    if (searchScope === null) return;

    let cancelled = false;
    findFloodShelterCandidates(position, searchScope).then((result) => {
      if (cancelled) return;
      setCandidatesLoading(false);
      if (result.status === "fetch_error") {
        setCandidatesError("避難場所データを取得できませんでした。通信環境をご確認ください。");
      } else if (result.status === "unsupported") {
        setCandidatesError("この地域の避難場所データは現在準備中です。");
      } else if (result.candidates.length === 0) {
        // 「避難所が無い」とは断定しない（公式データに洪水対応の指定が
        // 登録されていないだけの可能性がある）。
        setCandidatesError(
          "現在のデータでは、洪水対応の避難先候補を確認できませんでした。避難先が無いという意味ではありません。市区町村の公式情報をご確認ください。"
        );
      } else {
        setCandidates(result.candidates);
        setFailedNeighborPrefectures(result.failedPrefectureCodes);
        onCandidatesChange(result.candidates);
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
        riskSegments: segmentRisk,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeResults, selectedIndex, segmentRisk]);

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
    // 別の避難先へ切り替えた場合、前の避難先のルートに対する区間リスク評価を
    // 引き継がない(誤って別ルートの評価として表示されるのを防ぐ)。
    segmentRiskRequestIdRef.current++;
    setSegmentRisk(null);
    setSegmentRiskError(null);
    setSegmentRiskLoading(false);
    setExpandedSegmentIndex(null);

    await loadRoutes(candidate);
  };

  /** 行き先までの徒歩ルートを取得し、各ルートの洪水ハザードを評価する。 */
  const loadRoutes = async (candidate: FloodShelterCandidate) => {
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

  // 地図上の避難所の吹き出しから開いた場合は、その避難所へのルート取得から始める
  // （ルート比較・洪水ハザード評価を経てから案内を開始する、既存の流れを使う）。
  // 画面・行き先・読み込み中の状態は、useStateの初期値としてすでに設定している。
  useEffect(() => {
    if (initialDestination) void loadRoutes(initialDestination);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    // DEM標高＋洪水による区間別リスク評価(このルートを見ている間だけ)。
    // Phase 6: 内水氾濫はアプリ全体の対象外のため、inundationTileUrlは渡さない
    // （内水氾濫タイルへのリクエスト自体を行わない）。
    // 【重要】既存のroutingLoading/hazardEvalLoading/routeResultsとは独立した
    // 付加評価。失敗してもroutesError/routeResultsには一切触れない。
    setExpandedSegmentIndex(null);
    setSegmentRisk(null);
    setSegmentRiskError(null);
    if (!r) return;
    const requestId = ++segmentRiskRequestIdRef.current;
    setSegmentRiskLoading(true);
    evaluateRouteSegmentRisk(r.route.geometry)
      .then((result) => {
        if (segmentRiskRequestIdRef.current !== requestId) return; // 古いrequestは無視(ルート切り替え済み)
        setSegmentRisk(result.segments);
      })
      .catch(() => {
        if (segmentRiskRequestIdRef.current !== requestId) return;
        setSegmentRiskError("ルートは表示できますが、区間ごとのリスク評価を取得できませんでした");
      })
      .finally(() => {
        if (segmentRiskRequestIdRef.current === requestId) setSegmentRiskLoading(false);
      });
  };

  // Phase 6 PART B: 隣接府県の候補が一覧に含まれているか（府県境付近の検索時のみ）。
  const includesOtherPrefectureCandidates =
    searchScope !== null &&
    (searchScope.reason === "boundary_ambiguity" ||
      (candidates ?? []).some((c) => c.prefectureCode !== searchScope.primaryPrefectureCode));

  const modalTitle =
    view === "routeDetail"
      ? `${ROUTE_LABELS[selectedIndex] ?? "ルート"}について`
      : view === "shelterDetail"
        ? (detailShelter?.name ?? VIEW_TITLE.shelterDetail)
        : VIEW_TITLE[view];

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
      title={modalTitle}
    >
      {view === "candidates" && (
        <div>
          <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
            自治体が洪水時の指定緊急避難場所として指定している施設のうち、現在地から近い順に表示しています（直線距離）。
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
          {/* Phase 6 PART B: 府県境付近で隣接府県の候補を含む場合の案内（候補一覧内の小さな補足）。 */}
          {candidates && includesOtherPrefectureCandidates && (
            <p className="mt-2 rounded-[var(--radius-sm)] bg-[var(--color-surface-subtle)] px-2.5 py-2 text-xs leading-relaxed text-[var(--color-text-secondary)]">
              {searchScope?.reason === "boundary_ambiguity"
                ? "府県境のすぐ近くのため現在地の府県を確定できません。候補となる府県の避難先を合わせて表示しています。"
                : "府県境付近のため、隣接する府県の避難先も候補に含めています。"}
            </p>
          )}
          {candidates && failedNeighborPrefectures.length > 0 && (
            <p className="mt-2 text-xs leading-relaxed text-[var(--color-warning)]">
              {failedNeighborPrefectures.map((code) => PREFECTURE_NAMES[code]).join("・")}
              の避難所データを取得できなかったため、その府県の避難先は候補に含まれていません。
            </p>
          )}
          {/* Phase 6 PART D: 現在地の市区町村で公式データが部分提供の場合の補足。 */}
          {shelterDataCompleteness.emergencyEvacuationSites === "unavailable" && (
            <p className="mt-2 text-xs leading-relaxed text-[var(--color-text-muted)]">
              この地域では、公式避難所データの一部のみ提供されています（現在地の市町村の指定緊急避難場所データは公式に提供されていないため、候補は周辺市町村の避難先が中心になります）。
            </p>
          )}
          {shelterDataCompleteness.emergencyEvacuationSites !== "unavailable" &&
            shelterDataCompleteness.designatedShelters === "unavailable" && (
              <p className="mt-2 text-xs leading-relaxed text-[var(--color-text-muted)]">
                この地域では、公式避難所データの一部のみ提供されています（現在地の市町村の指定避難所データは公式に提供されていません）。
              </p>
            )}
          {candidatesUnsupported && (
            <div className="mt-4">
              <Notice tone="info" title="この地域の避難所データは現在準備中です">
                洪水時の避難先候補は近畿2府4県（大阪・京都・兵庫・滋賀・奈良・和歌山）に対応しています。それ以外の地域では、避難先候補を表示できません。
              </Notice>
            </div>
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
              <li key={c.id} className="rounded-[var(--radius-md)] border-2 border-[var(--color-border)] p-3.5">
                <div className="text-base font-bold text-[var(--color-text-primary)]">{c.name}</div>
                <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">{formatCandidateLocation(c)}</div>
                <div className="mt-1 text-sm text-[var(--color-text-secondary)]">
                  直線距離：約{formatMeters(c.straightLineDistanceMeters)}
                </div>
                <div className="mt-1 text-sm text-[var(--color-info)]">自治体の洪水対応指定あり</div>
                {toHazardLabels(c.hazards).length > 0 && (
                  <ul className="mt-1.5 flex flex-wrap gap-1">
                    {toHazardLabels(c.hazards).map((label) => (
                      <li
                        key={label}
                        className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2 py-0.5 text-xs font-bold text-[var(--color-text-primary)]"
                      >
                        {label}
                      </li>
                    ))}
                  </ul>
                )}
                {/* 電話番号・利用可能時間はここには表示せず、詳細画面へ分離する(§19)。 */}
                <div className="mt-3 flex gap-2">
                  <Button
                    onClick={() => {
                      setDetailShelter(c);
                      setView("shelterDetail");
                    }}
                    variant="secondary"
                    size="sm"
                    className="flex-1"
                  >
                    詳細を見る
                  </Button>
                  <Button onClick={() => handleSelectCandidate(c)} size="sm" className="flex-1">
                    ルートを見る
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {view === "routes" && (
        <div>
          {/* 地図上の避難所から直接開いた場合、洪水時の指定が無い避難所もありうる。
              ルート自体は表示するが、洪水時の避難先として適切とは限らないことを先に伝える。 */}
          {destination && !destination.floodDesignated && (
            <div className="mb-3">
              <Notice tone="warning" title="洪水時の避難先としては指定されていません">
                {destination.name}は、自治体が洪水時の指定緊急避難場所として指定している施設ではありません。洪水からの避難には、「近くの洪水対応避難先」の候補もあわせてご確認ください。
              </Notice>
            </div>
          )}
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
          <section>
            <h3 className="text-sm font-bold text-[var(--color-text-primary)]">
              区間別の参考評価（標高・洪水）
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
              標高・洪水の情報をもとにした、このアプリ独自の参考評価です。実際の道路状況や浸水状況を保証するものではありません。国土地理院・国土交通省等のデータを、このアプリが独自に組み合わせて評価したものであり、国や自治体がこの区間を危険と判定しているわけではありません。
            </p>

            {segmentRiskLoading && (
              <p className="mt-3 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                <span
                  className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
                  aria-hidden
                />
                ルート周辺のリスクを確認しています…
              </p>
            )}

            {segmentRiskError && (
              <div className="mt-3">
                <Notice tone="warning" title="区間ごとのリスク評価を取得できませんでした">
                  {segmentRiskError} ルート自体はそのままご利用いただけます。
                </Notice>
              </div>
            )}

            {segmentRisk && segmentRisk.length > 0 && (
              <>
                <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
                  <RouteRiskLegend />
                </div>
                <ul className="mt-3 space-y-1.5">
                  {segmentRisk.map((seg, i) => {
                    const p = ROUTE_RISK_LEVEL_PRESENTATION[seg.riskLevel];
                    const expanded = expandedSegmentIndex === i;
                    return (
                      <li key={i}>
                        <button
                          type="button"
                          onClick={() => setExpandedSegmentIndex(expanded ? null : i)}
                          aria-expanded={expanded}
                          className="flex min-h-11 w-full items-center gap-2.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-subtle)]"
                        >
                          <svg width="20" height="10" aria-hidden className="shrink-0">
                            <line
                              x1="0"
                              y1="5"
                              x2="20"
                              y2="5"
                              stroke={p.leafletColor}
                              strokeWidth={4}
                              strokeDasharray={p.dashed ? "4 3" : undefined}
                            />
                          </svg>
                          <span className="flex-1 text-[var(--color-text-primary)]">
                            {formatMeters(seg.startDistanceMeters)}〜{formatMeters(seg.endDistanceMeters)}：{p.label}
                          </span>
                          <span aria-hidden className="text-[var(--color-text-muted)]">
                            {expanded ? "▲" : "▼"}
                          </span>
                        </button>
                        {expanded && <RouteRiskDetail segment={seg} />}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>
          <section className="rounded-[var(--radius-md)] bg-[var(--color-surface-subtle)] p-3">
            <h3 className="text-sm font-bold text-[var(--color-text-primary)]">データについて</h3>
            <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
              自治体の洪水対応指定：{destination?.floodDesignated === false ? "なし" : "あり"}（国土地理院データ）
              <br />
              使用ハザードデータ：ハザードマップポータルサイト（洪水浸水想定区域）
              <br />
              使用標高データ：国土地理院 標高タイル（基盤地図情報数値標高モデル）を加工して作成。標高は測量時点のものであり、現在の状況を示すリアルタイムデータではありません。
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

      {view === "shelterDetail" && detailShelter && (
        <ShelterDetailContent
          shelter={detailShelter}
          onViewRoute={() => {
            const shelter = detailShelter;
            handleSelectCandidate(shelter);
          }}
        />
      )}
    </Modal>
  );
}
