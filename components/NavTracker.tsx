"use client";

// 試作3 PART A-3〜A-6: 選択した参考避難ルートに沿ったGPS追跡。
// <MapContainer>の子として描画する(react-leafletのuseMap()を使うため)。
//
// 【重要】ここでの計算(lib/navigation.ts)は洪水ハザード評価とは無関係の
// 表示専用ロジックであり、既存の研究ロジックには一切影響しない。
// また、ナビ開始時に選択したroute.geometryはそのまま使用し、ここで
// 別ルートへ勝手に再計算することはしない(A-1)。

import { useEffect, useRef, useState } from "react";
import { Marker, Circle, useMap } from "react-leaflet";
import L from "leaflet";
import {
  buildRoutePoints,
  findNearestPointOnRoute,
  findUpcomingStep,
  describeStep,
  initialOffRouteState,
  updateOffRouteState,
  hasArrivedNearDestination,
  type LatLng,
  type NavigationDisplayState,
} from "@/lib/navigation";
import type { WalkingRoute } from "@/lib/evacuationRoute";
import { buildLogEntry, type NavVerificationLogEntry } from "@/lib/navigationVerificationLog";

// 通常の「現在地」マーカーと区別するため、ナビ中の追跡位置は別の見た目にする
// （色だけに頼らないよう、青い円+白枠のシンプルな現在地ドットにしている）。
const trackedIcon = L.divIcon({
  className: "",
  html: '<div style="width:20px;height:20px;border-radius:50%;background:#1d4ed8;border:3px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.5);"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

export default function NavTracker({
  route,
  destination,
  onUpdate,
  navigationStartedAt,
  selectedRouteId,
  onVerificationLogEntry,
}: {
  route: WalkingRoute;
  destination: LatLng;
  onUpdate: (state: NavigationDisplayState) => void;
  /** 試作3 次段階 PART 6: 実地検証ログ用。ナビ開始時刻とルート識別子。 */
  navigationStartedAt: string;
  selectedRouteId: string;
  onVerificationLogEntry: (entry: NavVerificationLogEntry) => void;
}) {
  const map = useMap();
  const routePointsRef = useRef(buildRoutePoints(route.geometry));
  const offRouteRef = useRef(initialOffRouteState());
  const lastStateRef = useRef<NavigationDisplayState | null>(null);
  const hasCenteredRef = useRef(false);
  const [tracked, setTracked] = useState<{ position: LatLng; accuracy: number | null } | null>(null);

  useEffect(() => {
    if (!("geolocation" in navigator)) return;

    // A-3: GPSの取得間隔を独自に高頻度化しない。ブラウザ標準のwatchPositionに
    // 任せ、maximumAgeで極端に古いキャッシュ値だけを避ける設計にする。
    const watchId = navigator.geolocation.watchPosition(
      (result) => {
        const position: LatLng = { lat: result.coords.latitude, lng: result.coords.longitude };
        const accuracy = typeof result.coords.accuracy === "number" ? result.coords.accuracy : null;
        setTracked({ position, accuracy });

        const nearest = findNearestPointOnRoute(position, routePointsRef.current);
        const { nextStep } = nearest
          ? findUpcomingStep(route.steps, nearest.segmentIndex)
          : { nextStep: null };

        offRouteRef.current = updateOffRouteState(
          offRouteRef.current,
          nearest?.distanceFromRouteMeters ?? 0,
          accuracy
        );

        const arrived = hasArrivedNearDestination(position, destination, accuracy);

        const nextStepStartDistance = nextStep
          ? (routePointsRef.current[nextStep.wayPoints[0]]?.cumulativeDistanceMeters ?? 0)
          : 0;
        const distanceToNextManeuver = nextStep
          ? Math.max(0, nextStepStartDistance - (nearest?.distanceAlongRouteMeters ?? 0))
          : 0;

        const state: NavigationDisplayState = {
          position,
          accuracyMeters: accuracy,
          distanceRemainingMeters: nearest?.distanceRemainingMeters ?? route.distanceMeters,
          distanceToNextManeuverMeters: distanceToNextManeuver,
          nextInstructionJa: nextStep ? describeStep(nextStep) : null,
          isOffRoute: offRouteRef.current.isOffRoute,
          hasArrived: arrived,
          gpsSignalLost: false,
        };
        lastStateRef.current = state;
        onUpdate(state);

        // 試作3 次段階 PART 6: 実地検証用ログ（端末内メモリのみ。サーバーへは送信しない）。
        onVerificationLogEntry(
          buildLogEntry({
            event: "update",
            navigationStartedAt,
            selectedRouteId,
            gpsAccuracyMeters: accuracy,
            position,
            distanceRemainingMeters: state.distanceRemainingMeters,
            currentInstruction: state.nextInstructionJa,
            routeDeviation: state.isOffRoute,
            hasArrived: state.hasArrived,
          })
        );

        // 初回のみ大きくズームして現在地に寄せ、以降はズームを変えずパンのみで追従する
        // （ユーザーが手動でズーム操作した場合にそれを勝手に上書きしない）。
        if (!hasCenteredRef.current) {
          map.setView([position.lat, position.lng], 18);
          hasCenteredRef.current = true;
        } else {
          map.panTo([position.lat, position.lng], { animate: true });
        }
      },
      () => {
        // A-5: GPSが一時的に取得できなくても、即座に「逸脱」「到着」等を
        // 断定しない。判定状態(offRouteRef)は更新せず、直前の表示状態に
        // 「電波状況が悪い」旨のフラグだけを重ねて表示する。
        if (lastStateRef.current) {
          onUpdate({ ...lastStateRef.current, gpsSignalLost: true });
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
    // ルート・目的地はナビ開始時に固定されるため、依存配列は空でよい
    // （A-1: ナビ中に別ルートへ差し替えることはしない）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!tracked) return null;

  return (
    <>
      <Marker position={[tracked.position.lat, tracked.position.lng]} icon={trackedIcon} />
      {tracked.accuracy !== null && tracked.accuracy > 0 && (
        <Circle
          center={[tracked.position.lat, tracked.position.lng]}
          radius={tracked.accuracy}
          pathOptions={{ color: "#1d4ed8", fillColor: "#1d4ed8", fillOpacity: 0.1, weight: 1 }}
        />
      )}
    </>
  );
}
