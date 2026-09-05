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
import { assessRisk, type RiskResult } from "@/lib/riskAssessment";
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
  const [riskResult, setRiskResult] = useState<RiskResult | null>(null);
  const [isAssessingRisk, setIsAssessingRisk] = useState(false);
  const [showRiskDetail, setShowRiskDetail] = useState(false);
  const [showEvacuationPanel, setShowEvacuationPanel] = useState(false);
  const [evacuationRoutes, setEvacuationRoutes] = useState<{
    routes: WalkingRoute[];
    highlightedIndex: number;
    destination: FloodShelterCandidate;
  } | null>(null);

  const handleLocate = () => {
    setErrorMessage(null);

    if (!("geolocation" in navigator)) {
      setErrorMessage("この端末・ブラウザでは現在地の取得に対応していません。");
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (result) => {
        const lat = result.coords.latitude;
        const lng = result.coords.longitude;
        setPosition({ lat, lng });
        setIsLocating(false);

        // 現在地が取得できたら、続けてその場所の危険度を自動判定する
        setIsAssessingRisk(true);
        assessRisk(lat, lng)
          .then(setRiskResult)
          .finally(() => setIsAssessingRisk(false));
      },
      (error) => {
        setIsLocating(false);
        if (error.code === error.PERMISSION_DENIED) {
          setErrorMessage(
            "位置情報の利用が許可されていません。ブラウザの設定から位置情報を許可してください。"
          );
        } else {
          setErrorMessage("現在地を取得できませんでした。電波状況の良い場所で再度お試しください。");
        }
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

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

      <RiskCard
        result={riskResult}
        isLoading={isAssessingRisk}
        onOpenDetail={() => setShowRiskDetail(true)}
      />

      {position && (
        <div className="px-3 pt-2">
          <button
            type="button"
            onClick={() => setShowEvacuationPanel(true)}
            className="w-full rounded-lg bg-emerald-700 py-3 text-base font-bold text-white active:bg-emerald-800"
          >
            🏃 避難先を探す（洪水対応）
          </button>
        </div>
      )}

      <div
        role="group"
        aria-label="ハザード情報の表示切り替え"
        className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-3 py-2 bg-zinc-100 border-b-2 border-zinc-200"
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
        {HAZARD_BUTTONS.map((h) => (
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
          aria-label="現在地を取得する"
        >
          {isLocating ? "取得中..." : "📍 現在地を取得"}
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
