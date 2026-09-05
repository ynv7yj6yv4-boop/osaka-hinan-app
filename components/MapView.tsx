"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

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

  const handleLocate = () => {
    setErrorMessage(null);

    if (!("geolocation" in navigator)) {
      setErrorMessage("この端末・ブラウザでは現在地の取得に対応していません。");
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (result) => {
        setPosition({
          lat: result.coords.latitude,
          lng: result.coords.longitude,
        });
        setIsLocating(false);
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
          {position && (
            <Marker position={[position.lat, position.lng]} icon={defaultIcon}>
              <Popup>現在地（おおよその位置）</Popup>
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
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="px-4 py-3 bg-red-50 border-t-2 border-red-300 text-red-800 text-base font-medium"
        >
          {errorMessage}
        </div>
      )}
    </div>
  );
}
