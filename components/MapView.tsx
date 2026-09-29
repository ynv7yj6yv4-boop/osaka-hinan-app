"use client";

import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import ShelterLayer from "./ShelterLayer";
import { HAZARD_BUTTONS, HAZARD_TILE_URL, HAZARD_ATTRIBUTION, type HazardKey } from "./hazardLayers";
import CandidateMarkers from "./CandidateMarkers";
import AccountMenu from "./AccountMenu";
import RiskCard from "./RiskCard";
import DisasterInfoCard from "./DisasterInfoCard";
import RiskDetailModal from "./RiskDetailModal";
import EvacuationPanel from "./EvacuationPanel";
import IntroPanel from "./IntroPanel";
import NavTracker from "./NavTracker";
import NavigationOverlay from "./NavigationOverlay";
import HazardLayerControl from "./HazardLayerControl";
import Button from "./ui/Button";
import Notice from "./ui/Notice";
import { LocationIcon, InfoIcon } from "./ui/icons";
import { assessRisk, type RiskResult } from "@/lib/riskAssessment";
import { recordRiskHistoryEntry, type RecordRiskHistoryResult } from "@/lib/riskHistory";
import { checkRegion } from "@/lib/region/checkRegion";
import { getRegionCapability } from "@/lib/region/capability";
import type { RegionCheckResult, Region } from "@/lib/region/types";
import { KINKI_BOUNDS } from "@/lib/region/kinkiBounds.generated";
import { getShelterSearchScope } from "@/lib/shelter/crossPrefectureSearch";
import { getShelterDataCompleteness, summarizeShelterDataCompleteness } from "@/lib/shelter/dataCompleteness";
import { APP_NAME, APP_TARGET_AREA_LABEL, APP_TARGET_PREFECTURES_TEXT } from "@/lib/appInfo";
import { fetchWalkingRoutes, type WalkingRoute } from "@/lib/evacuationRoute";
import type { FloodShelterCandidate } from "@/lib/floodShelterCandidates";
import type { RouteRiskSegment } from "@/lib/routeSegmentRisk";
import { ROUTE_RISK_LEVEL_PRESENTATION } from "./routeRiskPresentation";
import type { NavigationDisplayState } from "@/lib/navigation";
import {
  buildLogEntry,
  triggerVerificationLogDownload,
  type NavVerificationLogEntry,
} from "@/lib/navigationVerificationLog";

// Leafletのデフォルトアイコン画像はNext.js環境だとパス解決に失敗するため、
// CDN上の画像を明示的に指定して置き換える。
const defaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// Phase 6 PART C: 位置情報取得前の初期表示は、大阪市役所の固定座標ではなく、
// 行政区域データから算出した近畿2府4県全体の外接矩形に合わせる
// （scripts/build-kinki-bounds.mjsが生成。位置情報取得後は従来どおり現在地へ移動）。
const INITIAL_BOUNDS = KINKI_BOUNDS;

// 試作2（要件定義書2 §5・§32）: 高潮を研究対象から除外したため、
// ハザード切替UIの選択肢からは高潮を外す。
// 内水氾濫も、Phase 6でアプリ全体の対象外とした（lib/region/capability.tsの
// INLAND_FLOOD_EVALUATION_ENABLED参照）ため、地図表示・危険度判定・
// ルート評価のいずれでも使わない（このアプリは洪水対応アプリとして扱う）。
const DISPLAYABLE_HAZARD_BUTTONS = HAZARD_BUTTONS.filter(
  (h) => h.key !== "hightide" && h.key !== "inundation"
);

/** Phase 3（地域拡張）: regionCheckから、避難所Provider（lib/shelter/provider.ts）
 *  等が必要とするRegionを取り出す。地域が判定できていない場合はnull。 */
function getRegion(regionCheck: RegionCheckResult | null): Region | null {
  if (!regionCheck || regionCheck.status !== "supported") return null;
  return regionCheck.region;
}

type LatLng = { lat: number; lng: number };

/** 現在地が取得できたら地図の表示範囲をそこへ移動させるための内部コンポーネント */
function RecenterOnLocate({ position }: { position: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (position) {
      map.setView([position.lat, position.lng], 16);
    }
  }, [position, map]);
  return null;
}

// 試作3（要件定義書2 PART I-4）: 地図を画面全体の背景として敷く構成に変更したため、
// パネル開閉自体では地図コンテナのサイズは変わらなくなった（オーバーレイのため）。
// ただし、スマホの画面回転・アドレスバーの表示/非表示による実際の表示領域の変化では
// Leafletのタイルが正しく再計算されない（グレーになる/中心がずれる）ことがあるため、
// ウィンドウのリサイズ時にinvalidateSize()を呼び、明示的に再計算させる。
function MapResizeHandler() {
  const map = useMap();
  useEffect(() => {
    // マウント直後の初回描画がずれることがあるため、少し遅らせて一度実行する
    const initialTimer = setTimeout(() => map.invalidateSize(), 200);

    const handleResize = () => map.invalidateSize();
    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);

    // visualViewport（アドレスバーの表示/非表示等）が使える場合は合わせて監視する
    window.visualViewport?.addEventListener("resize", handleResize);

    return () => {
      clearTimeout(initialTimer);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
      window.visualViewport?.removeEventListener("resize", handleResize);
    };
  }, [map]);
  return null;
}

export default function MapView() {
  const [position, setPosition] = useState<LatLng | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [activeHazard, setActiveHazard] = useState<HazardKey | null>(null);
  // スマートフォンUI改善: 対象地域の詳しい説明（コンパクトヘッダーの
  // 情報アイコン）の開閉。ハザード切替の開閉は HazardLayerControl 側の
  // 内部stateに移した（判定ロジック・選択肢は変更していない）。
  const [showAreaInfo, setShowAreaInfo] = useState(false);
  const [riskResult, setRiskResult] = useState<RiskResult | null>(null);
  const [isAssessingRisk, setIsAssessingRisk] = useState(false);
  // 研究用・UX改善用: 前回確認したリスクとの比較(この端末のlocalStorageのみ。
  // Firestore・通知判定には一切影響しない。lib/riskHistory.ts参照)。
  const [riskComparison, setRiskComparison] = useState<RecordRiskHistoryResult | null>(null);
  const [showRiskDetail, setShowRiskDetail] = useState(false);
  const [showEvacuationPanel, setShowEvacuationPanel] = useState(false);
  const [evacuationRoutes, setEvacuationRoutes] = useState<{
    routes: WalkingRoute[];
    highlightedIndex: number;
    destination: FloodShelterCandidate;
    riskSegments?: RouteRiskSegment[] | null;
  } | null>(null);
  // 地域判定基盤（Phase 2）: 旧 lib/osakaAreaCheck.ts の大阪市専用・矩形判定を廃止し、
  // 近畿2府4県の行政区域ポリゴンに対するPoint in Polygon判定（lib/region/）に
  // 置き換えた。status="supported"は近畿2府4県内と判定できたことのみを意味し、
  // 各機能（避難所・内水氾濫等）がその地域で実際に使えるかどうかは別
  // （regionCapability・getRegionCapability()を参照。「地域として近畿内」＝
  // 「機能が使える」ではない）。
  const [regionCheck, setRegionCheck] = useState<RegionCheckResult | null>(null);
  // Phase 6 PART B: 避難先候補パネルで選ばれた候補。現在府県の避難所レイヤー
  // （ShelterLayer）に含まれない隣接府県の候補だけを、地図上に別途表示する。
  const [shelterCandidates, setShelterCandidates] = useState<FloodShelterCandidate[]>([]);

  // 試作3 PART A: 選択した参考避難ルートでのナビゲーション。
  // navigationSessionがnullでない間は「ナビ中」とみなし、通常のRiskCard・
  // ハザード切替等を隠してNavigationOverlayに切り替える（要件I-10）。
  const [navigationSession, setNavigationSession] = useState<{
    route: WalkingRoute;
    destination: FloodShelterCandidate;
  } | null>(null);
  const [navState, setNavState] = useState<NavigationDisplayState | null>(null);
  const [isRecalculatingRoute, setIsRecalculatingRoute] = useState(false);
  const [recalculateError, setRecalculateError] = useState<string | null>(null);

  // 試作3 次段階 PART 2・6: ナビの実地検証用ログ（端末内メモリのみ・
  // サーバーへは一切送信しない）。navigationMetaはレンダー中にも参照する
  // ためstateにする(refをrender中に読むとReactの警告対象になるため)。
  // verificationLogRefはログ本体(頻繁に追記されるだけで表示に使わない)なので
  // refのままでよい。
  const [navigationMeta, setNavigationMeta] = useState<{ startedAt: string; routeId: string } | null>(
    null
  );
  const verificationLogRef = useRef<NavVerificationLogEntry[]>([]);

  const handleStartNavigation = (route: WalkingRoute, destination: FloodShelterCandidate) => {
    const startedAt = new Date().toISOString();
    const routeId = `${destination.id}-${startedAt}`;
    setNavigationMeta({ startedAt, routeId });
    verificationLogRef.current = [
      buildLogEntry({ event: "started", navigationStartedAt: startedAt, selectedRouteId: routeId }),
    ];

    setNavigationSession({ route, destination });
    setNavState(null);
    setRecalculateError(null);
    setShowEvacuationPanel(false);
    setShowRiskDetail(false);
  };

  const handleEndNavigation = () => {
    // A-1: 取得済みのルート表示自体は消さない（EvacuationPanelを閉じた後も
    // ルートを地図上で確認できる、という既存の挙動に合わせる）。
    if (navigationMeta) {
      const endedAt = new Date().toISOString();
      verificationLogRef.current.push(
        buildLogEntry({
          event: "ended",
          navigationStartedAt: navigationMeta.startedAt,
          selectedRouteId: navigationMeta.routeId,
          navigationEndedAt: endedAt,
        })
      );
      // PART 6: 位置履歴はサーバーへ送らず、端末内のJSONファイルとして
      // ダウンロードできるようにするだけ（研究・デバッグ用）。
      triggerVerificationLogDownload(verificationLogRef.current);
      console.log("[ナビ検証ログ]", verificationLogRef.current);
    }
    setNavigationMeta(null);
    verificationLogRef.current = [];

    setNavigationSession(null);
    setNavState(null);
  };

  // A-7: 自動での再ルーティングは行わない。ユーザー操作で明示的に
  // 現在地からルートを再取得するのみ（別ルートへの自動切り替えは将来拡張）。
  const handleRecalculateRoute = async () => {
    if (!navigationSession) return;
    const currentPos = navState?.position ?? position;
    if (!currentPos) return;

    setIsRecalculatingRoute(true);
    setRecalculateError(null);
    const result = await fetchWalkingRoutes(currentPos, {
      lat: navigationSession.destination.lat,
      lng: navigationSession.destination.lng,
    });
    setIsRecalculatingRoute(false);

    if (result.status === "error") {
      setRecalculateError(result.message);
      return;
    }
    const newRoute = result.routes[0];
    if (!newRoute) {
      setRecalculateError("現在、徒歩経路を取得できません");
      return;
    }

    setNavigationSession({ route: newRoute, destination: navigationSession.destination });
    setNavState(null);
    // 地図上のルート表示も、実際にナビしているルートに合わせて更新する
    setEvacuationRoutes({
      routes: [newRoute],
      highlightedIndex: 0,
      destination: navigationSession.destination,
    });
  };

  const handleLocate = () => {
    // 二重実行防止（取得中は連打しても再実行しない）
    if (isLocating) return;

    setErrorMessage(null);

    if (!("geolocation" in navigator)) {
      setErrorMessage(
        "この端末・ブラウザでは現在地の取得に対応していません。地図上のハザード表示は目視でご確認いただけます。"
      );
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (result) => {
        const lat = result.coords.latitude;
        const lng = result.coords.longitude;
        setPosition({ lat, lng });
        setIsLocating(false);

        // 現在地が変わったため、前の地点の避難先候補（地図上の隣接府県候補
        // マーカー）は消す。
        setShelterCandidates([]);
        checkRegion(lat, lng).then(setRegionCheck);

        // Phase 6: 内水氾濫をアプリ全体の対象外としたため、危険度判定の評価対象
        // （洪水のみ）は地域に依存しなくなった。地域判定の完了を待たずに並行して
        // 実行する（内水氾濫タイルへのリクエストも行わない）。
        setIsAssessingRisk(true);
        assessRisk(lat, lng)
          .then((result) => {
            setRiskResult(result);
            // 研究用・UX改善用: 前回確認時との比較をこの端末内(localStorage)だけで
            // 記録する。サーバーへは送信せず、失敗してもリスク表示自体は壊れない
            // (lib/riskHistory.ts参照)。
            setRiskComparison(recordRiskHistoryEntry(result.level, result.generatedAt));
          })
          .finally(() => setIsAssessingRisk(false));
      },
      (error) => {
        setIsLocating(false);
        // ブラウザのGeolocation APIが返すエラーコードを区別し、
        // 技術的なエラーコードではなく次に何をすべきかが分かる文言にする。
        switch (error.code) {
          case error.PERMISSION_DENIED:
            setErrorMessage(
              "位置情報の利用が許可されていません。ブラウザの設定から位置情報の利用を許可し、再度お試しください。"
            );
            break;
          case error.TIMEOUT:
            setErrorMessage(
              "現在地の取得に時間がかかりすぎました。電波状況の良い場所で再度お試しください。"
            );
            break;
          case error.POSITION_UNAVAILABLE:
            setErrorMessage(
              "現在地を特定できませんでした。屋外や窓際など、電波状況の良い場所で再度お試しください。"
            );
            break;
          default:
            setErrorMessage("現在地を取得できませんでした。しばらくしてから再度お試しください。");
        }
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Phase 6 PART B: 避難先候補の検索対象府県（府県境付近では隣接府県も含む）。
  const shelterSearchScope = getShelterSearchScope(regionCheck);
  const currentRegion = getRegion(regionCheck);
  // Phase 6 PART D: 現在地の市区町村の公式避難所データ提供状況。
  const shelterDataCompleteness = getShelterDataCompleteness(currentRegion?.municipalityCode);
  // 現在府県の避難所レイヤー（ShelterLayer）に含まれない候補だけを追加表示する
  // （府県境の判定があいまいでShelterLayer自体を表示しない場合は、すべての候補）。
  const markersOutsideShelterLayer = shelterCandidates.filter(
    (c) => c.prefectureCode !== currentRegion?.prefectureCode
  );

  // 試作3（要件定義書2 PART I）: 「地図を背景・中心にして、必要情報を重ねる」構成へ変更。
  // 情報カード・ボタンを縦に積み上げて地図を圧迫する旧構成をやめ、
  // 地図を画面全体(100dvh)の背景として敷き、その上に必要な情報だけを
  // 浮かせて重ねる(絶対配置のオーバーレイ)。判定ロジック・各要素の文言や
  // 表示条件そのものは変更していない（表示位置のみ変更）。
  return (
    <div className="relative h-dvh w-full overflow-hidden bg-zinc-200">
      {/* ==== 背景レイヤー：地図（画面全体） ==== */}
      <MapContainer
        bounds={INITIAL_BOUNDS}
        className="absolute inset-0 h-full w-full z-0"
      >
        <TileLayer
          attribution='&copy; <a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a>'
          url="https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png"
        />

        {activeHazard && (
          <TileLayer
            key={activeHazard}
            attribution={HAZARD_ATTRIBUTION}
            url={HAZARD_TILE_URL[activeHazard]}
            opacity={0.6}
          />
        )}

        <ShelterLayer activeHazard={activeHazard} region={currentRegion} />
        <CandidateMarkers candidates={markersOutsideShelterLayer} />

        {/* ナビ中はNavTrackerが専用の追跡マーカーを描画するため、
            一発取得の現在地マーカーとの重複表示を避ける。 */}
        {position && !navigationSession && (
          <Marker position={[position.lat, position.lng]} icon={defaultIcon}>
            <Popup>現在地（おおよその位置）</Popup>
          </Marker>
        )}

        {evacuationRoutes?.routes.map((r, i) => {
          const isHighlighted = i === evacuationRoutes.highlightedIndex;
          // DEM標高＋洪水・内水氾濫による区間別リスク評価(routeDetailを開いた
          // ルートのみ)が取得できていれば、選択中ルートだけを区間ごとに
          // 色分けした複数のPolylineとして描画する。取得できていない/評価中/
          // 失敗の場合や、選択されていない候補ルートは、従来どおりの単色線のまま
          // (標高取得の成否でルート自体の表示が変わらないようにするため)。
          if (isHighlighted && evacuationRoutes.riskSegments && evacuationRoutes.riskSegments.length > 0) {
            return evacuationRoutes.riskSegments.map((seg, si) => {
              const p = ROUTE_RISK_LEVEL_PRESENTATION[seg.riskLevel];
              return (
                <Polyline
                  key={`${i}-${si}`}
                  positions={seg.coordinates.map((pt) => [pt.lat, pt.lng])}
                  pathOptions={{
                    color: p.leafletColor,
                    weight: 5,
                    opacity: 0.9,
                    dashArray: p.dashed ? "6 6" : undefined,
                  }}
                />
              );
            });
          }
          return (
            <Polyline
              key={i}
              positions={r.geometry.map((p) => [p.lat, p.lng])}
              pathOptions={
                isHighlighted
                  ? { color: "#1d4ed8", weight: 5, opacity: 0.9 }
                  : { color: "#9ca3af", weight: 3, opacity: 0.6, dashArray: "6 6" }
              }
            />
          );
        })}

        {evacuationRoutes && (
          <Marker
            position={[evacuationRoutes.destination.lat, evacuationRoutes.destination.lng]}
            icon={defaultIcon}
          >
            <Popup>{evacuationRoutes.destination.name}</Popup>
          </Marker>
        )}

        <RecenterOnLocate position={position} />
        <MapResizeHandler />

        {/* 試作3 PART A-3〜A-6: ナビ中のGPS追跡・逸脱判定・到着判定。
            A-1: navigationSession.route.geometryはナビ開始時に選択したまま
            固定で使用し、ここで別ルートへ再計算することはしない。 */}
        {navigationSession && navigationMeta && (
          <NavTracker
            route={navigationSession.route}
            destination={navigationSession.destination}
            onUpdate={setNavState}
            navigationStartedAt={navigationMeta.startedAt}
            selectedRouteId={navigationMeta.routeId}
            onVerificationLogEntry={(entry) => verificationLogRef.current.push(entry)}
          />
        )}
      </MapContainer>

      {/* 試作3 PART A-4・I-10: ナビ中は通常のRiskCard・ハザード切替・洪水CTA等を
          隠し、NavigationOverlay（次の案内・残り距離・終了ボタン）に切り替える。
          地図そのもの・判定ロジックはどちらの状態でも変更しない。 */}
      {navigationSession ? (
        <NavigationOverlay
          state={navState}
          destinationName={navigationSession.destination.name}
          onEnd={handleEndNavigation}
          onRecalculate={handleRecalculateRoute}
          isRecalculating={isRecalculatingRoute}
          recalculateError={recalculateError}
        />
      ) : (
        <>
      {/* Phase 7: 横向き（パソコンのブラウザを含む）ではヘッダーを非表示にしているため、
          アカウントメニュー（ログアウト）の入口を地図の右上に小さく浮かせて表示する。
          縦向きではヘッダー内のアイコンを使うので、こちらは表示しない。 */}
      <div
        className="pointer-events-auto absolute z-[1000] hidden [@media(orientation:landscape)]:block"
        style={{ top: "max(0.75rem, env(safe-area-inset-top))", right: "max(0.75rem, env(safe-area-inset-right))" }}
      >
        <AccountMenu variant="floating" />
      </div>

      {/* ==== 前面レイヤー：地図の上に重ねる情報 ====
          親には pointer-events-none を指定し、地図のドラッグ・ピンチ操作を
          遮らないようにする。実際に操作可能な各カード側で pointer-events-auto を
          個別に指定する（iPhoneのノッチ・ステータスバー等はsafe-area-insetで回避）。
          【重要】上グループ・下グループを2つの独立したabsolute要素(top-0とbottom-0)
          にしていたところ、横向き(landscape)で画面高さが低い機種では両者の
          実際の高さの合計が画面高さを超え、中央で重なってしまう不具合があった。
          そのため1つのflexコンテナに統合し、上→下の自然な文書順で並べる
          （portraitはjustify-betweenで従来どおり上端/下端に分かれ、landscapeは
          隙間なく積み、はみ出した分はスクロールできるようにして「重なる」こと
          自体が起きない構造にした）。判定ロジック・表示内容自体は変更なし。 */}
      <div
        className="pointer-events-none absolute inset-0 z-[1000] flex flex-col justify-between gap-2 p-3 [@media(orientation:landscape)]:right-auto [@media(orientation:landscape)]:w-[340px] [@media(orientation:landscape)]:max-w-[75vw] [@media(orientation:landscape)]:justify-start [@media(orientation:landscape)]:overflow-y-auto"
        style={{
          paddingTop: "max(0.75rem, env(safe-area-inset-top))",
          paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
        }}
      >
        {/* 上グループ：ヘッダー・地域案内・RiskCard・災害関連情報カード。
            災害関連情報カードの追加により、RiskCard・DisasterInfoCardが
            両方展開されると縦向きの画面高さを超えることがあるため、この
            グループ自体をmin-h-0+overflow-y-autoでスクロール可能にし、
            下グループ（洪水CTA・ハザード切替・再取得ボタン等）が画面外に
            押し出されたり内容と重なったりしないようにしている
            （下グループ側はshrink-0で高さを維持）。 */}
        <div className="pointer-events-auto flex min-h-0 flex-col gap-2 overflow-y-auto">
          {/* アプリ名 + 短い常時免責（要件定義書2 I-6: 詳細はRiskDetailModal側に集約）。
              横向きは画面高さに余裕がなく、CTA・ハザード切替が画面外に押し出されて
              しまうため、ユーザーとの合意により横向き時のみ非表示にする
              （縦向きの表示は変更なし。免責自体を削除するわけではなく、
              RiskDetailModal等で引き続き確認できる）。
              スマートフォンUI改善: 対象地域の案内を常時表示のこのヘッダー2行目に
              統合し、情報アイコンで詳しい注意書きを開閉できるようにした（対象地域は
              常に見える状態を維持しつつ、詳細説明は必要なときだけ表示）。
              Phase 6 PART C: 近畿2府4県対応版の名称・対象表示に変更（lib/appInfo.ts）。
              行数・高さは従来と同じ2行に保ち、地図の表示面積を狭めない。
              「対応地域外」の警告(outside)は安全上より重要なため、
              統合せず引き続き別のNoticeとして表示する。 */}
          <div className="pointer-events-auto rounded-[var(--radius-md)] bg-[var(--color-surface)]/95 px-3.5 py-2 shadow-[var(--shadow-sm)] [@media(orientation:landscape)]:hidden">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h1 className="text-sm font-bold leading-tight text-[var(--color-text-primary)]">
                  {APP_NAME}
                </h1>
                <p className="mt-0.5 text-[11px] leading-snug text-[var(--color-text-muted)]">
                  参考情報・{APP_TARGET_AREA_LABEL}
                </p>
              </div>
              {/* Phase 7: アカウントメニュー（ログアウト等）。情報アイコンと同じ大きさの
                  アイコンを並べるだけにし、ヘッダーの高さ・地図の表示面積は変えない。 */}
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowAreaInfo((v) => !v)}
                  aria-expanded={showAreaInfo}
                  aria-controls="app-info-detail"
                  aria-label="このアプリについての注意書きを開く"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--color-text-secondary)]"
                >
                  <InfoIcon className="h-5 w-5" />
                </button>
                <AccountMenu />
              </div>
            </div>
            {showAreaInfo && (
              <p
                id="app-info-detail"
                className="mt-1.5 border-t border-[var(--color-border)] pt-1.5 text-[11px] leading-snug text-[var(--color-text-muted)]"
              >
                ※本アプリは参考情報です。公式情報も必ずご確認ください。対象は近畿2府4県（{APP_TARGET_PREFECTURES_TEXT}）で、災害種別は洪水のみを扱います。対象地域外では情報が不正確な場合があります。
              </p>
            )}
          </div>

          {!position && (
            <div className="pointer-events-auto">
              <IntroPanel isLocating={isLocating} onLocate={handleLocate} />
            </div>
          )}

          {/* 地域判定基盤（Phase 2）: regionCheck.statusごとの案内。
              「判定不能(unknown/error)」と「近畿外(outside)」を混同しないよう、
              それぞれ別の文言・トーンで表示する（判定不能を近畿外と誤認しない）。 */}
          {position && regionCheck?.status === "outside" && (
            <div className="pointer-events-auto">
              <Notice tone="warning" title="現在地は本アプリの対応地域外の可能性があります">
                本アプリは近畿2府4県（{APP_TARGET_PREFECTURES_TEXT}）を対象としており、表示される情報は実際と異なる場合があります。
              </Notice>
            </div>
          )}

          {position && (regionCheck?.status === "unknown" || regionCheck?.status === "error") && (
            <div className="pointer-events-auto">
              <Notice tone="info" title="現在地の地域を判定できませんでした">
                都道府県境付近にいるか、通信環境により判定できませんでした。表示される情報が実際の地域と異なる場合があります。
              </Notice>
            </div>
          )}

          {/* 現在地の対応地域を小さく表示する。近畿2府4県内であることが判定
              できても、その地域で各機能が実際に使えるとは限らないため
              （lib/region/capability.ts参照）、対応が限定的な地域では
              その旨も併記する（「近畿全域対応が完了した」という誤解を
              避けるため）。 */}
          {position && regionCheck?.status === "supported" && (
            <div className="pointer-events-auto rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)]/95 px-3 py-1.5 text-xs text-[var(--color-text-secondary)] shadow-[var(--shadow-sm)]">
              現在地：{regionCheck.region.prefectureName}
              {regionCheck.region.municipalityName ?? ""}
              {(() => {
                // Phase 6: 内水氾濫はアプリ全体の対象外（地域ごとの「準備中」ではない）
                // ため、「一部機能は準備中」の判定材料から除く。
                const capability = getRegionCapability(regionCheck.region);
                const hasLimitedCapability = [
                  capability.flood,
                  capability.shelter,
                  capability.rainfall,
                  capability.elevation,
                ].some((s) => s !== "supported");
                return hasLimitedCapability ? (
                  <span className="mt-0.5 block text-[var(--color-text-muted)]">
                    ※この地域の一部機能は現在準備中です
                  </span>
                ) : null;
              })()}
              {/* Phase 6 PART D: 公式データが部分提供の市区町村では、小さな補足だけを出す
                  （地図を覆う警告カードにはしない）。 */}
              {summarizeShelterDataCompleteness(shelterDataCompleteness) === "partial" && (
                <span className="mt-0.5 block text-[var(--color-text-muted)]">
                  ※この地域では、公式避難所データの一部のみ提供されています
                </span>
              )}
            </div>
          )}

          <div className="pointer-events-auto">
            <RiskCard
              result={riskResult}
              isLoading={isAssessingRisk}
              onOpenDetail={() => setShowRiskDetail(true)}
              comparison={riskComparison}
            />
          </div>

          {/* 河川・道路・避難所の公式情報リンク（リアルタイム自動取得は未対応）。
              既存のRiskCard・判定ロジック・避難所データには一切触れていない。 */}
          <div className="pointer-events-auto">
            <DisasterInfoCard />
          </div>
        </div>

        {/* 下グループ：レイヤー・現在地ボタン行 → 注意表示 → 洪水CTA。
            スマートフォンUI改善: 以前は現在地ボタンだけが完全に独立した
            absolute要素（画面右下固定）で、下グループ側はpr-20の余白で
            それを避けていた。今回、現在地ボタンを丸型FABに変更したうえで
            この下グループのflexレイアウトに統合し、ハザード切替も
            HazardLayerControl（コンパクトなボタン＋Bottom Sheet）に
            置き換えたことで、pr-20による余白確保が不要になった。
            横向きは既に左側の細い帯に収まっているため、この行もそのまま使う。 */}
        <div className="flex shrink-0 flex-col gap-2">
          {/* ハザードレイヤーが選択されている間の凡例。以前はbottom-24 left-4に
              固定ピクセルで独立配置していたが、下グループの内容量（通知・CTAの
              有無）によって実際の下部スタックの高さが変わるため、固定オフセット
              だと重なる可能性があった。レイヤー行の直前に置く通常のflex要素に
              変更し、下部スタックの高さに関わらず必ず正しい位置に収まるようにした。 */}
          {activeHazard && (
            <div className="pointer-events-auto flex flex-col gap-1.5 self-start rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]/95 px-3.5 py-2.5 text-xs text-[var(--color-text-secondary)] shadow-[var(--shadow-sm)]">
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 shrink-0 rounded-full bg-[var(--color-success)]" />
                選択中の災害でも使える避難場所
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 shrink-0 rounded-full bg-zinc-500" />
                その他の指定緊急避難場所
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 shrink-0 rounded-full bg-[var(--color-primary)]" />
                指定避難所
              </div>
            </div>
          )}

          <div className="flex items-end justify-between gap-2">
            <div className="pointer-events-auto">
              <HazardLayerControl
                hazardButtons={DISPLAYABLE_HAZARD_BUTTONS}
                activeHazard={activeHazard}
                onChange={setActiveHazard}
              />
            </div>

            {/* 現在地「再取得」ボタン。スマートフォン向けに丸型FAB化した
                （目安52〜56px）。機能・onClickロジックは変更していない。
                ナビ中はNavTrackerが継続的に現在地を追跡するため、この
                ブロック自体がnavigationSession分岐の外側(else)にあり非表示になる。 */}
            <button
              type="button"
              onClick={handleLocate}
              disabled={isLocating}
              className="pointer-events-auto flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-white shadow-[var(--shadow-md)] transition-colors hover:bg-[var(--color-primary-hover)] active:bg-[var(--color-primary-hover)] disabled:opacity-60"
              aria-label={position ? "現在地を再取得" : "現在地を取得"}
            >
              <LocationIcon className="h-6 w-6 shrink-0" />
            </button>
          </div>

          {errorMessage && (
            <div className="pointer-events-auto">
              <Notice tone="danger" title="現在地を確認できませんでした">
                {errorMessage}
              </Notice>
            </div>
          )}

          {/* 「洪水時の避難先候補を見る」: このアプリで最も重要なCTAの1つのため、
              削除せず画面下部に維持する（目安高さ56〜64px、Buttonのsize="lg"を
              そのまま使用）。 */}
          {position && (
            <div className="pointer-events-auto">
              <Button
                onClick={() => setShowEvacuationPanel(true)}
                variant="primary"
                fullWidth
                size="lg"
              >
                洪水時の避難先候補を見る
              </Button>
            </div>
          )}
        </div>
      </div>
        </>
      )}

      {showRiskDetail && riskResult && (
        <RiskDetailModal result={riskResult} onClose={() => setShowRiskDetail(false)} />
      )}

      {showEvacuationPanel && position && (
        <EvacuationPanel
          position={position}
          searchScope={shelterSearchScope}
          shelterDataCompleteness={shelterDataCompleteness}
          onCandidatesChange={setShelterCandidates}
          onClose={() => setShowEvacuationPanel(false)}
          onRoutesChange={setEvacuationRoutes}
          onStartNavigation={handleStartNavigation}
        />
      )}
    </div>
  );
}
