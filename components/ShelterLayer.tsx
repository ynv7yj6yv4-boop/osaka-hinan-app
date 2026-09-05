"use client";

import { useEffect, useRef, useState } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import type { HazardKey } from "./hazardLayers";
import { HAZARD_LABELS } from "./hazardLayers";

type ShelterFeature = {
  id: string;
  type: "shelter" | "evacuation_site";
  name: string;
  address: string;
  lat: number;
  lng: number;
  hazards: HazardKey[];
};

type SheltersData = {
  source: string;
  sourceUrl: string;
  fetchedAt: string;
  notice: string;
  features: ShelterFeature[];
};

// 種類・対応状況ごとにアイコン（色だけに頼らず絵文字でも区別する）
function makeIcon(kind: "shelter" | "safe" | "other") {
  const style =
    kind === "safe"
      ? { bg: "#16a34a", emoji: "✅" } // 選択中の災害に対応：緑
      : kind === "shelter"
      ? { bg: "#2563eb", emoji: "🏠" } // 指定避難所：青
      : { bg: "#6b7280", emoji: "📍" }; // その他の指定緊急避難場所：グレー

  return L.divIcon({
    html: `<div style="background:${style.bg};width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.4);font-size:14px;">${style.emoji}</div>`,
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

function hazardLabelList(hazards: HazardKey[]): string {
  if (hazards.length === 0) return "災害種別の指定なし";
  return hazards.map((h) => HAZARD_LABELS[h]).join("・");
}

export default function ShelterLayer({ activeHazard }: { activeHazard: HazardKey | null }) {
  const map = useMap();
  const [data, setData] = useState<SheltersData | null>(null);
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null);

  // データは初回のみ取得（792KB程度の静的JSON）
  useEffect(() => {
    let cancelled = false;
    fetch("/data/osaka-shelters.json")
      .then((res) => res.json())
      .then((json: SheltersData) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        // 取得失敗時は避難所レイヤーを表示しないだけにする（地図自体は使えるようにする）
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!data) return;

    const group = L.markerClusterGroup({ maxClusterRadius: 60 });

    for (const f of data.features) {
      const isMatch = activeHazard !== null && f.hazards.includes(activeHazard);
      const icon = makeIcon(f.type === "shelter" ? "shelter" : isMatch ? "safe" : "other");

      const marker = L.marker([f.lat, f.lng], { icon });
      const typeLabel = f.type === "shelter" ? "指定避難所" : "指定緊急避難場所";
      marker.bindPopup(
        `<div style="font-size:14px;line-height:1.5;">
          <strong>${f.name}</strong><br/>
          ${typeLabel}<br/>
          ${f.address}<br/>
          ${f.type === "evacuation_site" ? `対応災害：${hazardLabelList(f.hazards)}` : ""}
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
  }, [data, activeHazard, map]);

  return null;
}
