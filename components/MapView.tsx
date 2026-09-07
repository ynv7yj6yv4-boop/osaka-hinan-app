"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import ShelterLayer from "./ShelterLayer";
import { HAZARD_BUTTONS, HAZARD_TILE_URL, HAZARD_ATTRIBUTION, type HazardKey } from "./hazardLayers";
import RiskCard from "./RiskCard";
import RiskDetailModal from "./RiskDetailModal";
import EvacuationPanel from "./EvacuationPanel";
import IntroPanel from "./IntroPanel";
import { assessRisk, type RiskResult } from "@/lib/riskAssessment";
import { checkOsakaArea, type OsakaAreaCheckResult } from "@/lib/osakaAreaCheck";
import type { WalkingRoute } from "@/lib/evacuationRoute";
import type { FloodShelterCandidate } from "@/lib/floodShelterCandidates";

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

  return (
    <div className="flex flex-col h-dvh w-full">
      <header className="px-4 py-3 bg-white border-b-2 border-zinc-200">
        <h1 className="text-xl font-bold text-zinc-900 leading-tight">
          大阪市 避難支援マップ（試作版）
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          これは参考情報です。公式の避難情報は必ず自治体の発表をご確認ください。
        </p>
      </header>

      {!position && <IntroPanel isLocating={isLocating} onLocate={handleLocate} />}

      {position && areaCheck === "clearly_outside" && (
        <div className="mx-3 mt-2 rounded-lg border-2 border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-900">
          現在地は大阪市エリアから明らかに離れている可能性があります。本アプリは大阪市を対象としており、表示される情報は実際と異なります。
        </div>
      )}

      {/* Phase6.1: 矩形内であっても「大阪市内である」ことは確認できていないため、
          常に対象地域を明示する（隣接自治体の地点でも表示される）。
          試作2: 地図優先レイアウトのため1行に収まる分量にコンパクト化（文言・判定は変更なし）。 */}
      {position && areaCheck === "likely_osaka_or_nearby" && (
        <div className="mx-3 mt-2 rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-1 text-xs text-zinc-600">
          現在のMVPは大阪市が対象です（市外では情報が不正確な場合があります）
        </div>
      )}

      <RiskCard
        result={riskResult}
        isLoading={isAssessingRisk}
        onOpenDetail={() => setShowRiskDetail(true)}
      />

      {position && (
        <div className="px-3 pt-2">
          {/* Phase6.1: 現在の主なリスクが洪水以外(内水氾濫)の場合、
              この機能が「現在のリスクへの対応」であるかのように見えないよう、
              ボタンを押す前に注意書きを先に表示し、ボタン自体の見た目も
              控えめにする（洪水対応機能そのものは非表示にしない）。
              試作2: 高潮を対象から除外したため、文言も内水氾濫のみに変更。 */}
          {floodIsNotThePrimaryHazard && (
            <p className="mb-1 rounded-lg border-2 border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
              ⚠ 現在の危険度は主に内水氾濫によるものです。下記の参考避難ルート機能は洪水のみに対応しており、現在の危険度には対応していません。
            </p>
          )}
          <button
            type="button"
            onClick={() => setShowEvacuationPanel(true)}
            className={
              floodIsNotThePrimaryHazard
                ? "w-full rounded-lg border-2 border-zinc-400 bg-white py-3 text-base font-bold text-zinc-700 active:bg-zinc-50"
                : "w-full rounded-lg bg-emerald-700 py-3 text-base font-bold text-white active:bg-emerald-800"
            }
          >
            🏃 洪水時の避難先候補を見る
          </button>
        </div>
      )}

      {/* 試作2: 常時2行分の高さを占めていたハザード切替を折りたたみ式にし、
          既定では閉じておく（地図優先）。選択肢は高潮除外により3択に変更。 */}
      <div className="bg-zinc-100 border-b-2 border-zinc-200">
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

      <div className="relative flex-1">
        <MapContainer
          center={OSAKA_CITY_CENTER}
          zoom={DEFAULT_ZOOM}
          className="h-full w-full"
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

          {position && (
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
        </MapContainer>

        <button
          type="button"
          onClick={handleLocate}
          disabled={isLocating}
          className="absolute bottom-6 right-4 z-[1000] flex items-center gap-2 rounded-full bg-blue-700 px-6 py-4 text-lg font-bold text-white shadow-lg active:bg-blue-800 disabled:opacity-60"
          aria-label={position ? "現在地を再取得する" : "現在地を取得する"}
        >
          {isLocating ? "確認しています…" : position ? "📍 現在地を再取得" : "📍 現在地を取得"}
        </button>

        {activeHazard && (
          <div className="absolute bottom-6 left-4 z-[1000] flex flex-col gap-1 rounded-lg bg-white/95 px-3 py-2 text-xs text-zinc-700 shadow">
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
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="px-4 py-3 bg-red-50 border-t-2 border-red-300 text-red-800 text-base font-medium"
        >
          {errorMessage}
        </div>
      )}

      {showRiskDetail && riskResult && (
        <RiskDetailModal result={riskResult} onClose={() => setShowRiskDetail(false)} />
      )}

      {showEvacuationPanel && position && (
        <EvacuationPanel
          position={position}
          onClose={() => setShowEvacuationPanel(false)}
          onRoutesChange={setEvacuationRoutes}
        />
      )}
    </div>
  );
}
