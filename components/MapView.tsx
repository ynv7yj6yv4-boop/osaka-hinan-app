"use client";

import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import ShelterLayer from "./ShelterLayer";
import { HAZARD_BUTTONS, HAZARD_TILE_URL, HAZARD_ATTRIBUTION, type HazardKey } from "./hazardLayers";
import RiskCard from "./RiskCard";
import RiskDetailModal from "./RiskDetailModal";
import EvacuationPanel from "./EvacuationPanel";
import IntroPanel from "./IntroPanel";
import NavTracker from "./NavTracker";
import NavigationOverlay from "./NavigationOverlay";
import { assessRisk, type RiskResult } from "@/lib/riskAssessment";
import { checkOsakaArea, type OsakaAreaCheckResult } from "@/lib/osakaAreaCheck";
import { fetchWalkingRoutes, type WalkingRoute } from "@/lib/evacuationRoute";
import type { FloodShelterCandidate } from "@/lib/floodShelterCandidates";
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

// 大阪市役所付近を初期表示の中心地点とする
const OSAKA_CITY_CENTER: [number, number] = [34.6937, 135.5023];
const DEFAULT_ZOOM = 13;

// 試作2（要件定義書2 §5・§32）: 高潮を研究対象から除外したため、
// ハザード切替UIの選択肢からは高潮を外す。
// 【重要】components/hazardLayers.ts のHAZARD_BUTTONS自体（高潮のタイルURL等）は
// 削除していない。ここではUI表示用に絞り込むだけで、データは残す。
const DISPLAYABLE_HAZARD_BUTTONS = HAZARD_BUTTONS.filter((h) => h.key !== "hightide");

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
  // 試作2: 地図をより中心にしたスマートフォンUIへの改善（要件定義書2 §31 問題①）。
  // ハザード切替は「常時表示」ではなく「必要なときだけ開く」折りたたみUIにし、
  // 常時表示は RiskCard・洪水避難CTA・地図に絞る（判定ロジック自体は変更しない）。
  const [hazardPanelOpen, setHazardPanelOpen] = useState(false);
  const [riskResult, setRiskResult] = useState<RiskResult | null>(null);
  const [isAssessingRisk, setIsAssessingRisk] = useState(false);
  const [showRiskDetail, setShowRiskDetail] = useState(false);
  const [showEvacuationPanel, setShowEvacuationPanel] = useState(false);
  const [evacuationRoutes, setEvacuationRoutes] = useState<{
    routes: WalkingRoute[];
    highlightedIndex: number;
    destination: FloodShelterCandidate;
  } | null>(null);
  // Phase6.1: 「矩形内＝大阪市内」を意味しない。矩形内(likely_osaka_or_nearby)は
  // 大阪市かどうか確認できていない状態、矩形外(clearly_outside)は明らかに
  // 離れている可能性が高い状態。それぞれ別の案内を表示する。
  const [areaCheck, setAreaCheck] = useState<OsakaAreaCheckResult | null>(null);

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
        setAreaCheck(checkOsakaArea(lat, lng));

        // 現在地が取得できたら、続けてその場所の危険度を自動判定する
        setIsAssessingRisk(true);
        assessRisk(lat, lng)
          .then(setRiskResult)
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

  // 洪水以外(内水氾濫)のみでリスクが出ている場合、参考避難ルート機能が
  // その原因ハザードに対応していないことを案内するためのフラグ。
  // Phase5Aの洪水専用ルート評価ロジックそのものは変更していない。
  // 試作2: 高潮はlib/riskAssessment.tsのRiskLevel算出対象から除外したため、
  // ここでの比較対象も内水氾濫のみとする（riskResult.factorsにも高潮は含まれなくなった）。
  const floodFactor = riskResult?.factors.find((f) => f.key === "flood");
  const inundationScore = riskResult?.factors.find((f) => f.key === "inundation")?.score ?? 0;
  const floodIsNotThePrimaryHazard = Boolean(
    riskResult && inundationScore > 0 && (floodFactor?.score ?? 0) === 0
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
        center={OSAKA_CITY_CENTER}
        zoom={DEFAULT_ZOOM}
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

        <ShelterLayer activeHazard={activeHazard} />

        {/* ナビ中はNavTrackerが専用の追跡マーカーを描画するため、
            一発取得の現在地マーカーとの重複表示を避ける。 */}
        {position && !navigationSession && (
          <Marker position={[position.lat, position.lng]} icon={defaultIcon}>
            <Popup>現在地（おおよその位置）</Popup>
          </Marker>
        )}

        {evacuationRoutes?.routes.map((r, i) => (
          <Polyline
            key={i}
            positions={r.geometry.map((p) => [p.lat, p.lng])}
            pathOptions={
              i === evacuationRoutes.highlightedIndex
                ? { color: "#1d4ed8", weight: 5, opacity: 0.9 }
                : { color: "#9ca3af", weight: 3, opacity: 0.6, dashArray: "6 6" }
            }
          />
        ))}

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
        {/* 上グループ：ヘッダー・地域案内・RiskCard */}
        <div className="flex flex-col gap-2">
          {/* アプリ名 + 短い常時免責（要件定義書2 I-6: 詳細はRiskDetailModal側に集約）。
              横向きは画面高さに余裕がなく、CTA・ハザード切替が画面外に押し出されて
              しまうため、ユーザーとの合意により横向き時のみ非表示にする
              （縦向きの表示は変更なし。免責自体を削除するわけではなく、
              RiskDetailModal等で引き続き確認できる）。 */}
          <div className="pointer-events-auto rounded-xl bg-white/95 px-3 py-1.5 shadow [@media(orientation:landscape)]:hidden">
            <h1 className="text-sm font-bold leading-tight text-zinc-900">
              大阪市 避難支援マップ（試作版）
            </h1>
            <p className="mt-0.5 text-[11px] leading-snug text-zinc-600">
              ※参考情報です。公式情報も必ずご確認ください。
            </p>
          </div>

          {!position && (
            <div className="pointer-events-auto">
              <IntroPanel isLocating={isLocating} onLocate={handleLocate} />
            </div>
          )}

          {position && areaCheck === "clearly_outside" && (
            <div className="pointer-events-auto rounded-lg border-2 border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-900 shadow">
              現在地は大阪市エリアから明らかに離れている可能性があります。本アプリは大阪市を対象としており、表示される情報は実際と異なります。
            </div>
          )}

          {/* Phase6.1: 矩形内であっても「大阪市内である」ことは確認できていないため、
              常に対象地域を明示する（隣接自治体の地点でも表示される）。
              試作2: 地図優先レイアウトのため1行に収まる分量にコンパクト化（文言・判定は変更なし）。
              試作3: 横向きは高さの余裕を確保するため非表示（ユーザーとの合意）。
              「明らかに大阪市外」の警告(clearly_outside)は安全上重要なため、
              横向きでも引き続き表示する。 */}
          {position && areaCheck === "likely_osaka_or_nearby" && (
            <div className="pointer-events-auto rounded-lg border border-zinc-300 bg-white/95 px-3 py-1 text-xs text-zinc-600 shadow [@media(orientation:landscape)]:hidden">
              現在のMVPは大阪市が対象です（市外では情報が不正確な場合があります）
            </div>
          )}

          <div className="pointer-events-auto">
            <RiskCard
              result={riskResult}
              isLoading={isAssessingRisk}
              onOpenDetail={() => setShowRiskDetail(true)}
            />
          </div>
        </div>

        {/* 下グループ：洪水CTA・ハザード切替・エラー表示
            縦向きは現在地取得ボタンとの重なりを避けるため右側を空ける。
            横向きは既に左側の細い帯に収まっているため、その余白は不要。 */}
        <div className="flex flex-col gap-2 pr-20 [@media(orientation:landscape)]:pr-0">
          {position && (
            <div className="pointer-events-auto">
              {/* Phase6.1: 現在の主なリスクが洪水以外(内水氾濫)の場合、
                  この機能が「現在のリスクへの対応」であるかのように見えないよう、
                  ボタンを押す前に注意書きを先に表示し、ボタン自体の見た目も
                  控えめにする（洪水対応機能そのものは非表示にしない）。
                  試作2: 高潮を対象から除外したため、文言も内水氾濫のみに変更。 */}
              {floodIsNotThePrimaryHazard && (
                <p className="mb-1 rounded-lg border-2 border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900 shadow">
                  ⚠ 現在の危険度は主に内水氾濫によるものです。下記の参考避難ルート機能は洪水のみに対応しており、現在の危険度には対応していません。
                </p>
              )}
              <button
                type="button"
                onClick={() => setShowEvacuationPanel(true)}
                className={
                  floodIsNotThePrimaryHazard
                    ? "w-full rounded-lg border-2 border-zinc-400 bg-white py-3 text-base font-bold text-zinc-700 shadow active:bg-zinc-50"
                    : "w-full rounded-lg bg-emerald-700 py-3 text-base font-bold text-white shadow active:bg-emerald-800"
                }
              >
                🏃 洪水時の避難先候補を見る
              </button>
            </div>
          )}

          {/* 試作2: 常時2行分の高さを占めていたハザード切替を折りたたみ式にし、
              既定では閉じておく（地図優先）。選択肢は高潮除外により3択に変更。
              試作3: 全幅バーではなく、地図に浮かせた小型カードに変更。 */}
          <div className="pointer-events-auto rounded-xl bg-white/95 shadow">
            <button
              type="button"
              onClick={() => setHazardPanelOpen((v) => !v)}
              aria-expanded={hazardPanelOpen}
              aria-controls="hazard-toggle-panel"
              className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-bold text-zinc-700"
            >
              <span>
                🗺️ ハザード表示：
                {activeHazard
                  ? `${DISPLAYABLE_HAZARD_BUTTONS.find((h) => h.key === activeHazard)?.emoji ?? ""} ${
                      DISPLAYABLE_HAZARD_BUTTONS.find((h) => h.key === activeHazard)?.label ?? ""
                    }`
                  : "表示しない"}
              </span>
              <span aria-hidden>{hazardPanelOpen ? "▲ 閉じる" : "▼ 切り替える"}</span>
            </button>
            {hazardPanelOpen && (
              <div
                id="hazard-toggle-panel"
                role="group"
                aria-label="ハザード情報の表示切り替え"
                className="grid grid-cols-3 gap-2 px-3 pb-2.5"
              >
                <button
                  type="button"
                  onClick={() => setActiveHazard(null)}
                  aria-pressed={activeHazard === null}
                  className={`py-3 rounded-lg text-base font-bold border-2 ${
                    activeHazard === null
                      ? "bg-zinc-800 text-white border-zinc-800"
                      : "bg-white text-zinc-700 border-zinc-300"
                  }`}
                >
                  表示しない
                </button>
                {DISPLAYABLE_HAZARD_BUTTONS.map((h) => (
                  <button
                    key={h.key}
                    type="button"
                    onClick={() => setActiveHazard(h.key)}
                    aria-pressed={activeHazard === h.key}
                    className={`py-3 rounded-lg text-base font-bold border-2 ${
                      activeHazard === h.key
                        ? "bg-blue-700 text-white border-blue-700"
                        : "bg-white text-zinc-700 border-zinc-300"
                    }`}
                  >
                    {h.emoji} {h.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="pointer-events-auto rounded-lg border-2 border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-800 shadow"
            >
              {errorMessage}
            </div>
          )}
        </div>
      </div>

      {/* 現在地取得ボタン（右下固定）。縦向きは下グループのpr-20で右側を空けているため重ならない。
          ナビ中はNavTrackerが継続的に現在地を追跡するため非表示にする。 */}
      <button
        type="button"
        onClick={handleLocate}
        disabled={isLocating}
        className="absolute bottom-6 right-4 z-[1000] flex items-center gap-2 rounded-full bg-blue-700 px-5 py-4 text-base font-bold text-white shadow-lg active:bg-blue-800 disabled:opacity-60"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
        aria-label={position ? "現在地を再取得する" : "現在地を取得する"}
      >
        {isLocating ? "確認中…" : position ? "📍 再取得" : "📍 現在地"}
      </button>

      {/* ハザード切替パネルを開いている間は下部オーバーレイが縦に伸びるため、
          凡例と重ならないよう一時的に隠す（判定・データ自体は無関係）。 */}
      {activeHazard && !hazardPanelOpen && (
        <div className="absolute bottom-24 left-4 z-[1000] flex flex-col gap-1 rounded-lg bg-white/95 px-3 py-2 text-xs text-zinc-700 shadow">
          <div className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-full bg-green-600" />
            選択中の災害でも使える避難場所
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-full bg-zinc-500" />
            その他の指定緊急避難場所
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-full bg-blue-600" />
            指定避難所
          </div>
        </div>
      )}
        </>
      )}

      {showRiskDetail && riskResult && (
        <RiskDetailModal result={riskResult} onClose={() => setShowRiskDetail(false)} />
      )}

      {showEvacuationPanel && position && (
        <EvacuationPanel
          position={position}
          onClose={() => setShowEvacuationPanel(false)}
          onRoutesChange={setEvacuationRoutes}
          onStartNavigation={handleStartNavigation}
        />
      )}
    </div>
  );
}
