// 試作3 PART A: 選択した参考避難ルートに沿ったナビゲーション補助ロジック。
//
// 【重要】このファイルは既存の洪水ハザード評価(lib/routeHazardEvaluation.ts,
// lib/routeHazardMath.ts)を一切変更しない、完全に別レイヤーのモジュールである。
// ここでの計算は「選択済みのルート上で、現在地がどのあたりにいるか」を
// 表示するためだけのものであり、洪水ハザード判定・Coverage計算・
// floodCrossingDistance等の研究ロジックには一切関与しない。
//
// また、A-1の合意事項どおり、ナビ開始後にルートを再計算して
// 選択ルートとは別の道へ勝手に変更することはしない
// （現在地からの再確認は、ユーザー操作による明示的な再取得としてのみ提供する）。

import { haversineDistanceMeters, type LatLng } from "./routeHazardMath.ts";
import type { RouteStep } from "./evacuationRoute.ts";

export type { LatLng };

// ============================================================
// 案内文言（ORSの"language"パラメータには依存しない）
// ============================================================
//
// 【重要な設計判断・経緯】
// openrouteserviceの language パラメータで日本語(ja)の案内文を取得できないか
// 実際にAPIへ問い合わせて検証したところ、現在使用しているエンドポイント
// (api.heigit.org)では language: "ja" を指定すると502エラーになった。
// ORS公式のAPI仕様(openapi.yml)のLanguages enumにも日本語は列挙されておらず、
// 「日本語対応済み」という一部の二次情報は誤りの可能性が高い（詳細はチャット
// 記録・data/README.md参照）。対応状況を推測で扱わないという方針に基づき、
// ORSの言語パラメータには依存しないことにした。
//
// 代わりに、ORS公式ドキュメントで仕様が確定している数値の"type"
// (曲がり方コード, 0〜13, 出典:
// https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/instruction-types)
// と、"name"（道路名。OSMデータのため日本語の場合が多い）・"distance"を
// 組み合わせて、このアプリ側で日本語の案内文を組み立てる。
const MANEUVER_LABELS: Record<number, string> = {
  0: "左折",
  1: "右折",
  2: "急な左折",
  3: "急な右折",
  4: "やや左折",
  5: "やや右折",
  6: "直進",
  7: "ラウンドアバウトに進入",
  8: "ラウンドアバウトを出る",
  9: "Uターン",
  10: "目的地に到着",
  11: "出発",
  12: "左方向を維持",
  13: "右方向を維持",
};

/** ORSのstep 1件を、日本語の案内文言に変換する（道路名が分かれば併記する）。 */
export function describeStep(step: RouteStep): string {
  const maneuver = MANEUVER_LABELS[step.type] ?? "進む";
  if (step.streetName) {
    return `${maneuver}（${step.streetName}）`;
  }
  return maneuver;
}

// ============================================================
// ルート上の位置計算
// ============================================================

export type RoutePoint = LatLng & {
  /** ルート始点からの道なり累積距離(m)。lib/routeHazardMath.tsのcumulativeDistance
   *  と同じ考え方だが、間隔サンプリングはせず頂点そのものに付与する軽量版。 */
  cumulativeDistanceMeters: number;
};

/** ルートのgeometry(頂点列)に、道なりの累積距離を付与する。 */
export function buildRoutePoints(geometry: LatLng[]): RoutePoint[] {
  const points: RoutePoint[] = [];
  let cumulative = 0;
  for (let i = 0; i < geometry.length; i++) {
    if (i > 0) cumulative += haversineDistanceMeters(geometry[i - 1], geometry[i]);
    points.push({ ...geometry[i], cumulativeDistanceMeters: cumulative });
  }
  return points;
}

export type NearestPointOnRoute = {
  point: LatLng;
  /** 現在地からルート(折れ線)までの最短距離(m)の近似値 */
  distanceFromRouteMeters: number;
  /** ルート始点からの道なり距離(m)（現在地に最も近いルート上の点の位置） */
  distanceAlongRouteMeters: number;
  /** ルート終点までの残り道なり距離(m) */
  distanceRemainingMeters: number;
  /** 最も近かった線分の始点インデックス（geometry配列内） */
  segmentIndex: number;
};

/**
 * 現在地から見て、ルート(折れ線)上で最も近い地点を求める。
 * 都市規模(数km以内)の距離であれば、緯度による経度方向の縮尺差を単純に
 * 補正した平面近似で十分な精度が得られる（洪水ハザード評価の距離計算とは
 * 別目的・別実装であり、Coverage等の精度要件には影響しない）。
 */
function projectPointToSegment(p: LatLng, a: LatLng, b: LatLng): { point: LatLng; t: number } {
  const latRad = (a.lat * Math.PI) / 180;
  const kx = Math.cos(latRad); // 経度1度の実距離を緯度1度基準に補正する係数
  const ax = a.lng * kx;
  const ay = a.lat;
  const bx = b.lng * kx;
  const by = b.lat;
  const px = p.lng * kx;
  const py = p.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return { point: { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }, t };
}

export function findNearestPointOnRoute(
  position: LatLng,
  routePoints: RoutePoint[]
): NearestPointOnRoute | null {
  if (routePoints.length < 2) return null;

  let best: NearestPointOnRoute | null = null;
  const total = routePoints[routePoints.length - 1].cumulativeDistanceMeters;

  for (let i = 0; i < routePoints.length - 1; i++) {
    const a = routePoints[i];
    const b = routePoints[i + 1];
    const { point, t } = projectPointToSegment(position, a, b);
    const distanceFromRoute = haversineDistanceMeters(position, point);

    if (!best || distanceFromRoute < best.distanceFromRouteMeters) {
      const segLen = b.cumulativeDistanceMeters - a.cumulativeDistanceMeters;
      const distanceAlong = a.cumulativeDistanceMeters + segLen * t;
      best = {
        point,
        distanceFromRouteMeters: distanceFromRoute,
        distanceAlongRouteMeters: distanceAlong,
        distanceRemainingMeters: Math.max(0, total - distanceAlong),
        segmentIndex: i,
      };
    }
  }
  return best;
}

/** 現在地に最も近いルート上の位置から、次に案内すべきstepを特定する。 */
export function findUpcomingStep(
  steps: RouteStep[],
  nearestSegmentIndex: number
): { currentStep: RouteStep | null; nextStep: RouteStep | null } {
  // 各stepのwayPoints(始点・終点の頂点インデックス)から、現在地が
  // どのstepの区間を歩いているかを特定する。
  const currentStepIdx = steps.findIndex(
    (s) => nearestSegmentIndex >= s.wayPoints[0] && nearestSegmentIndex < s.wayPoints[1]
  );
  const currentStep = currentStepIdx >= 0 ? steps[currentStepIdx] : null;
  // ORSの案内文は「そのstepの開始地点で行う操作」を表す。つまり現在stepを
  // 直進中の場合、次に案内すべき操作は「次のstep」の指示文になる
  // （例: 「120m先、Xで右折」という表示は次stepのinstructionを使う）。
  const nextStep =
    currentStepIdx >= 0 && currentStepIdx + 1 < steps.length ? steps[currentStepIdx + 1] : null;
  return { currentStep, nextStep };
}

// ============================================================
// ルート逸脱判定（A-6）
// ============================================================
//
// 【閾値設計の根拠】（実装前に説明のうえ、必要であれば調整する前提の初期値）
// - OFF_ROUTE_BASE_METERS = 30m
//   徒歩ルートは道路・歩道の幅、公園や広場のショートカット等で数mの差が
//   日常的に生じる。また市街地ではGPS単独測位の誤差が数m〜数十mに達する
//   ことがある。30mは「1ブロック分歩いてようやく逸脱と判断される」程度の
//   保守的な基準とした。
// - OFF_ROUTE_ACCURACY_MULTIPLIER = 1.5
//   ブラウザのGeolocation APIが返すaccuracy(m)は実装依存だが、多くの環境で
//   「その半径内に真の位置がある可能性が高い」という円の半径として扱われる。
//   1.5倍の余裕を持たせることで、GPS精度が悪い状況(ビルの谷間等)で
//   誤って「逸脱」と表示することを避ける。
// - OFF_ROUTE_CONSECUTIVE_READINGS = 3
//   単発のGPS飛び(マルチパス等)で誤判定しないよう、閾値を超える読み取りが
//   3回連続した場合にのみ「逸脱の可能性」を表示する。1回でも閾値内に
//   戻れば連続カウントをリセットする（A-5: GPS一時喪失で即断定しない）。
//
// これらは研究上の「災害リスク判定」ではなく、ナビゲーションUIの表示
// タイミングを決めるものだが、根拠のない数値を独自に決定しないという
// 開発方針(基本ルール1)に沿って、上記の理由を明記している。
//
// 【重要・試作3 次段階 PART 7】以下の値は実地テスト前の**暫定設定値**であり、
// 「検証済みの最適値」ではない。実際に歩いて、(1)正しくルート上にいる時に
// 誤って逸脱扱いされないか、(2)実際に道を外れた時に検出できるか、
// (3)建物の多い場所でGPS誤差がどう影響するか、を確認してから確定させる
// （data/README.mdにも同内容を記載）。
export const OFF_ROUTE_BASE_METERS = 30;
export const OFF_ROUTE_ACCURACY_MULTIPLIER = 1.5;
export const OFF_ROUTE_CONSECUTIVE_READINGS = 3;

export type OffRouteTrackingState = {
  /** 閾値を連続で超えている回数 */
  consecutiveOverThreshold: number;
  /** 表示上「逸脱している可能性があります」を出すかどうか */
  isOffRoute: boolean;
};

export function initialOffRouteState(): OffRouteTrackingState {
  return { consecutiveOverThreshold: 0, isOffRoute: false };
}

/**
 * 1回分のGPS読み取り結果を反映して、逸脱判定の状態を更新する（純粋関数）。
 * accuracyMeters が取得できない場合は OFF_ROUTE_BASE_METERS のみを基準にする。
 */
export function updateOffRouteState(
  prev: OffRouteTrackingState,
  distanceFromRouteMeters: number,
  accuracyMeters: number | null
): OffRouteTrackingState {
  const threshold = Math.max(
    OFF_ROUTE_BASE_METERS,
    (accuracyMeters ?? 0) * OFF_ROUTE_ACCURACY_MULTIPLIER
  );

  if (distanceFromRouteMeters <= threshold) {
    // 閾値内に戻ったら即座に「逸脱していない」扱いに戻す（保守的な側に倒す）
    return { consecutiveOverThreshold: 0, isOffRoute: false };
  }

  const consecutiveOverThreshold = prev.consecutiveOverThreshold + 1;
  return {
    consecutiveOverThreshold,
    isOffRoute: consecutiveOverThreshold >= OFF_ROUTE_CONSECUTIVE_READINGS,
  };
}

// ============================================================
// 到着判定（A-8）
// ============================================================
//
// 【閾値設計の根拠】
// ARRIVAL_BASE_METERS = 30m。避難場所の多くは学校・公園等の一定の敷地面積を
// 持つ施設であり、施設の代表点(緯度経度1点)と実際の入口・敷地境界との間には
// 数m〜数十mの差がありうる。GPS誤差も加わるため、「敷地に到着した」ではなく
// 「付近に到着した」という表現(A-8の指示どおり)を用いる前提で30mとした。
//
// 【重要・試作3 次段階 PART 8】これも実地テスト前の**暫定設定値**である。
// 「安全な場所へ到着しました」等の断定表現は使用しない方針を維持したまま、
// 実地テストの結果に応じて数値のみ調整する想定。
export const ARRIVAL_BASE_METERS = 30;

export function hasArrivedNearDestination(
  position: LatLng,
  destination: LatLng,
  accuracyMeters: number | null
): boolean {
  const threshold = Math.max(ARRIVAL_BASE_METERS, accuracyMeters ?? 0);
  return haversineDistanceMeters(position, destination) <= threshold;
}

// ============================================================
// ナビ画面表示用の状態（components/NavTracker.tsx → NavigationOverlay.tsx）
// ============================================================

export type NavigationDisplayState = {
  position: LatLng;
  /** ブラウザGeolocation APIが返す位置精度(m)。取得できない場合はnull（A-5参照）。 */
  accuracyMeters: number | null;
  /** ルート終点までの残り道なり距離(m) */
  distanceRemainingMeters: number;
  /** 次の曲がり角までの残り距離(m)。最終区間の場合は0。 */
  distanceToNextManeuverMeters: number;
  /** 次に行うべき案内文（日本語）。最終区間等でnullの場合あり。 */
  nextInstructionJa: string | null;
  isOffRoute: boolean;
  hasArrived: boolean;
  /** 直近のGPS取得に失敗した(位置は前回値を維持している)ことを示すフラグ */
  gpsSignalLost: boolean;
};
