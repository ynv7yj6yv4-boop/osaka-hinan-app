"use client";

import { useEffect, useRef, useState } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import type { HazardKey } from "./hazardLayers";
import { toHazardLabels } from "./hazardLayers";
import { getShelters } from "@/lib/shelter/provider";
import type { Shelter } from "@/lib/shelter/types";
import type { Region } from "@/lib/region/types";

// マーカー表示用に必要な最小限の形（避難所詳細ロジックはここでは扱わない）。
type ShelterFeature = {
  id: string;
  type: "shelter" | "evacuation_site";
  name: string;
  address: string;
  lat: number;
  lng: number;
  hazards: HazardKey[];
  telephone?: string | null;
  availableHours?: string | null;
  /** 吹き出しからルート画面を開くときに渡す元データ。 */
  shelter: Shelter;
};

function toShelterFeature(s: Shelter): ShelterFeature {
  return {
    id: s.id,
    type: s.shelterType === "designated_shelter" ? "shelter" : "evacuation_site",
    name: s.name,
    address: s.address ?? "",
    lat: s.lat,
    lng: s.lng,
    hazards: s.hazards as HazardKey[],
    telephone: s.telephone,
    availableHours: s.availableHours,
    shelter: s,
  };
}

// 種類・対応状況ごとにアイコン（色だけに頼らず絵文字でも区別する）
function makeIcon(kind: "shelter" | "safe" | "other") {
  // UI刷新: 色だけに頼らず絵文字も併用する既存方針は維持しつつ、
  // グローバルなデザイントークン(CSS変数)と同じ色を使い一貫性を持たせる。
  const style =
    kind === "safe"
      ? { bg: "var(--color-success)", emoji: "✅" } // 選択中の災害に対応：緑
      : kind === "shelter"
      ? { bg: "var(--color-primary)", emoji: "🏠" } // 指定避難所：青
      : { bg: "#6b7280", emoji: "📍" }; // その他の指定緊急避難場所：グレー

  return L.divIcon({
    html: `<div style="background:${style.bg};width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.4);font-size:14px;">${style.emoji}</div>`,
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

/**
 * 吹き出しを開くときに地図を自動で動かす際の余白。地図の上に重ねている
 * カード（縦向きは上部のヘッダー・リスク表示・下部のボタン、横向きは左側の列）の
 * 裏に吹き出しが隠れないようにする。CandidateMarkers.tsxでも使う。
 */
export function getPopupAutoPanPadding(): { topLeft: [number, number]; bottomRight: [number, number] } {
  const landscape = typeof window !== "undefined" && window.matchMedia("(orientation: landscape)").matches;
  return landscape
    ? { topLeft: [360, 16], bottomRight: [72, 16] }
    : { topLeft: [16, 240], bottomRight: [16, 140] };
}

function hazardLabelText(hazards: HazardKey[]): string {
  const labels = toHazardLabels(hazards);
  if (labels.length === 0) return "災害種別の指定なし";
  return labels.join("・");
}

export default function ShelterLayer({
  activeHazard,
  region,
  onRequestRoute,
}: {
  activeHazard: HazardKey | null;
  /** 吹き出しの「この避難所へのルートを見る」を押したとき。ルート画面を開く処理は
   *  MapView側で行う（このレイヤーはルート取得のロジックを持たない）。 */
  onRequestRoute: (shelter: Shelter) => void;
  /** Phase 3（地域拡張）: 現在地の地域（lib/region/checkRegion.ts参照）。
   *  Phase 6 PART B: 府県境付近でも、この常時表示レイヤーは現在府県のデータだけを
   *  描画する（隣接府県の候補はCandidateMarkers.tsxが個別に描画する）。
   *  避難所データを提供しているProvider（lib/shelter/provider.ts）が
   *  存在する都道府県の場合のみ取得・表示する。nullの場合
   *  （まだ現在地を取得していない等）も表示しない
   *  （現在地が不明な状態で特定府県のデータを既定で表示しない）。 */
  region: Region | null;
}) {
  const map = useMap();
  // fetchedFeatures: 最後に取得できたデータ（region未対応時もクリアせず
  // 保持する。再度対応地域に戻った際、キャッシュ経由で即座に復元できるため）。
  // 実際に描画するのは下記effectiveFeatures（region===nullなら常にnull）。
  const [fetchedFeatures, setFetchedFeatures] = useState<ShelterFeature[] | null>(null);
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null);
  // マーカーは大量にあるため、コールバックが変わるたびにマーカーを作り直さないよう、
  // 最新のコールバックはrefで参照する。
  const onRequestRouteRef = useRef(onRequestRoute);
  useEffect(() => {
    onRequestRouteRef.current = onRequestRoute;
  }, [onRequestRoute]);

  useEffect(() => {
    if (!region) return; // 未対応地域では取得しない（既存のfetchedFeaturesはそのままでよい。描画側で除外する）
    let cancelled = false;
    getShelters(region.prefectureCode).then((result) => {
      if (cancelled) return;
      setFetchedFeatures(result.status === "ok" ? result.shelters.map(toShelterFeature) : null);
    });
    return () => {
      cancelled = true;
    };
  }, [region]);

  const features = region ? fetchedFeatures : null;

  useEffect(() => {
    if (!features) return;

    const group = L.markerClusterGroup({ maxClusterRadius: 60 });
    const popupPadding = getPopupAutoPanPadding();

    for (const f of features) {
      const isMatch = activeHazard !== null && f.hazards.includes(activeHazard);
      const icon = makeIcon(f.type === "shelter" ? "shelter" : isMatch ? "safe" : "other");

      const marker = L.marker([f.lat, f.lng], { icon });
      const typeLabel = f.type === "shelter" ? "指定避難所" : "指定緊急避難場所";
      // 避難所詳細情報の拡充: 大阪市オープンデータで補完できた場合のみ、
      // 電話番号・避難可能時間を追記する(無ければ何も足さない。推測しない)。
      const telephoneLine = f.telephone ? `電話：${f.telephone}<br/>` : "";
      const availableHoursLine = f.availableHours ? `利用可能時間：${f.availableHours}<br/>` : "";
      marker.bindPopup(
        `<div style="font-size:14px;line-height:1.5;">
          <strong>${f.name}</strong><br/>
          ${typeLabel}<br/>
          ${f.address}<br/>
          ${f.type === "evacuation_site" ? `対応災害：${hazardLabelText(f.hazards)}<br/>` : ""}
          ${telephoneLine}
          ${availableHoursLine}
          <button type="button" data-route-button style="margin-top:8px;width:100%;min-height:44px;border:0;border-radius:10px;background:var(--color-primary);color:#fff;font-size:14px;font-weight:700;cursor:pointer;">
            この避難所へのルートを見る
          </button>
        </div>`,
        {
          autoPanPaddingTopLeft: popupPadding.topLeft,
          autoPanPaddingBottomRight: popupPadding.bottomRight,
        }
      );
      // 吹き出しはLeafletがHTML文字列から生成するため、開かれたときにボタンへ
      // クリック処理を付ける（吹き出しを閉じてからルート画面を開く）。
      marker.on("popupopen", (e: L.PopupEvent) => {
        const button = e.popup.getElement()?.querySelector<HTMLButtonElement>("[data-route-button]");
        if (!button) return;
        button.onclick = () => {
          map.closePopup();
          onRequestRouteRef.current(f.shelter);
        };
      });
      group.addLayer(marker);
    }

    map.addLayer(group);
    clusterGroupRef.current = group;

    return () => {
      map.removeLayer(group);
      clusterGroupRef.current = null;
    };
  }, [features, activeHazard, map]);

  return null;
}
