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

function hazardLabelText(hazards: HazardKey[]): string {
  const labels = toHazardLabels(hazards);
  if (labels.length === 0) return "災害種別の指定なし";
  return labels.join("・");
}

export default function ShelterLayer({
  activeHazard,
  region,
}: {
  activeHazard: HazardKey | null;
  /** Phase 3（地域拡張）: 現在地の地域（lib/region/checkRegion.ts参照）。
   *  避難所データを提供しているProvider（lib/shelter/provider.ts）が
   *  存在する都道府県の場合のみ取得・表示する。nullの場合
   *  （まだ現在地を取得していない等）も表示しない
   *  （現在地が不明な状態で大阪府のデータを既定で表示しない）。 */
  region: Region | null;
}) {
  const map = useMap();
  // fetchedFeatures: 最後に取得できたデータ（region未対応時もクリアせず
  // 保持する。再度対応地域に戻った際、キャッシュ経由で即座に復元できるため）。
  // 実際に描画するのは下記effectiveFeatures（region===nullなら常にnull）。
  const [fetchedFeatures, setFetchedFeatures] = useState<ShelterFeature[] | null>(null);
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null);

  useEffect(() => {
    if (!region) return; // 未対応地域では取得しない（既存のfetchedFeaturesはそのままでよい。描画側で除外する）
    let cancelled = false;
    getShelters(region).then((result) => {
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
        </div>`
      );
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
