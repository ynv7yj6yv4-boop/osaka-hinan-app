"use client";

// Phase 6 PART B: 府県境検索で候補に選ばれた「隣接府県の避難先」を地図上に表示する。
//
// 通常の避難所レイヤー（ShelterLayer.tsx）は現在府県のデータだけを描画する
// （隣接府県の全施設を常時描画すると、府県境付近以外でも隣接府県のJSONが
// 必要になってしまうため）。そのため、隣接府県から候補に選ばれた施設は
// ここで個別に描画し、候補一覧に出た施設を地図上でも確認できるようにする。

import { Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import type { FloodShelterCandidate } from "@/lib/floodShelterCandidates";
import { getPopupAutoPanPadding } from "./ShelterLayer";

// ShelterLayer.tsxの指定緊急避難場所アイコンと同じ大きさ・形にし、
// 「府県境付近の候補」であることは絵文字と枠線色で区別する（色だけに頼らない）。
const candidateIcon = L.divIcon({
  html: `<div style="background:var(--color-success);width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:3px solid var(--color-primary);box-shadow:0 1px 3px rgba(0,0,0,0.4);font-size:14px;">🏫</div>`,
  className: "",
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  popupAnchor: [0, -14],
});

export default function CandidateMarkers({
  candidates,
  onRequestRoute,
}: {
  candidates: FloodShelterCandidate[];
  /** 吹き出しの「この避難所へのルートを見る」を押したとき（ルート画面はMapView側で開く）。 */
  onRequestRoute: (candidate: FloodShelterCandidate) => void;
}) {
  const map = useMap();
  const popupPadding = getPopupAutoPanPadding();
  return (
    <>
      {candidates.map((c) => (
        <Marker key={c.id} position={[c.lat, c.lng]} icon={candidateIcon}>
          <Popup autoPanPaddingTopLeft={popupPadding.topLeft} autoPanPaddingBottomRight={popupPadding.bottomRight}>
            <div style={{ fontSize: 14, lineHeight: 1.5 }}>
              <strong>{c.name}</strong>
              <br />
              {[c.prefectureName, c.municipalityName].filter(Boolean).join(" ")}
              <br />
              洪水時の避難先候補（府県境付近の検索結果）
              <button
                type="button"
                onClick={() => {
                  map.closePopup();
                  onRequestRoute(c);
                }}
                style={{
                  marginTop: 8,
                  width: "100%",
                  minHeight: 44,
                  border: 0,
                  borderRadius: 10,
                  background: "var(--color-primary)",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                この避難所へのルートを見る
              </button>
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  );
}
