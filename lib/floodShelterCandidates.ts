// Phase 5A: 洪水を対象とした避難先候補の抽出
// Phase 3（地域拡張）: 大阪市専用のJSON直接fetchから、
// lib/shelter/provider.ts（都道府県単位のShelterProvider）経由の
// 取得へ一般化した。UI層（EvacuationPanel.tsx等）が使う
// FloodShelterCandidate型・findFloodShelterCandidates()のシグネチャの
// 意味合いは変えていない（regionを追加の引数として受け取るようになった点のみ変更）。
//
// 【方針（ユーザーとの合意事項）】
// - 対象災害は洪水のみ。高潮・内水氾濫は別途設計する（内水氾濫は現段階で対象外）。
// - 候補は shelterType === "designated_emergency_evacuation_site" かつ
//   supportedDisasters.flood === true のものだけを対象とする
//   （flood: false・"unknown"はいずれも候補にしない。"designated_shelter"
//   （指定避難所）への自動フォールバックも行わない）。
// - 候補地点がハザードマップ上どうであれ、自治体の公式な洪水対応指定を
//   アプリ側の判定で上書き・除外しない（候補地点自体のハザード判定は
//   ここでは行わない。表示するとしても「参考情報」であることを明確にし、
//   絞り込みには使わない）。
// - 「最適な避難先」を自動決定するのではなく、近い順の候補プールを提示し、
//   最終的にどこへ行くかはユーザーが選択する。
// - 市区町村単位での絞り込みは行わない（下記findFloodShelterCandidates()の
//   コメント参照）。都道府県内の全候補を距離順にソートするだけの単純な方式を
//   採用しており、これにより市境付近でも自然に隣接市町村の候補が
//   考慮される。

import { getShelters } from "./shelter/provider.ts";
import type { PrefectureCode, Region } from "./region/types.ts";
import type { Shelter } from "./shelter/types.ts";

export type ShelterFeature = {
  id: string;
  type: "shelter" | "evacuation_site";
  name: string;
  address: string;
  lat: number;
  lng: number;
  hazards: string[];
  // 避難所詳細情報の拡充: 地域のオープンデータ等で補完できた場合のみ値が入る。
  // 名寄せできなかった場合はすべてnull(推測で埋めない)。
  telephone?: string | null;
  availableHours?: string | null;
  ward?: string | null;
  category?: string | null;
};

export type FloodShelterCandidate = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  /** 現在地からの直線距離（メートル）。道なりの距離ではないことに注意 */
  straightLineDistanceMeters: number;
  type: "shelter" | "evacuation_site";
  hazards: string[];
  telephone: string | null;
  availableHours: string | null;
  ward: string | null;
  category: string | null;
  /** Phase 4: 候補の都道府県コード。複数府県に対応したため、UI側で
   *  府県ごとの公式リンク出し分け等に使う（例: ShelterDetailContent.tsx）。 */
  prefectureCode: PrefectureCode;
};

// 候補として表示する件数。卒論の検証等で変更しやすいよう定数化している。
export const CANDIDATE_POOL_SIZE = 5;

// 地球を球体とみなした簡易距離計算（Haversine公式）。
// 道路に沿った距離ではなく、あくまで直線距離であることをUI表示でも明示する。
function haversineDistanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371000; // 地球の半径(m)の近似値
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type FloodCandidateResult =
  | { status: "ok"; candidates: FloodShelterCandidate[] }
  | { status: "unsupported" }
  | { status: "fetch_error" };

/**
 * 現在地から近い順に、洪水対応の指定緊急避難場所を最大 CANDIDATE_POOL_SIZE 件返す。
 * 「最適な1件」を決定するものではなく、候補プールを提示するのみ。
 *
 * 【市区町村での絞り込みを行わない理由】region.municipalityCode
 * （Phase 2で取得可能）を使って現在の市区町村だけに候補を限定することも
 * 検討したが、以下の理由から採用しなかった：
 * - 市境付近では、行政区域上は隣接市町村でも直線距離では現在地から
 *   近い候補が存在しうる（例：市境をまたいだ数十m先の指定緊急避難場所）。
 *   市区町村限定はこのケースで、実際にはより近い安全な候補を除外して
 *   しまう可能性がある。
 * - 大阪府全域でも候補プール（指定緊急避難場所は約5,600件、洪水対応は
 *   約3,100件）は小さく、距離順ソートのコストは無視できる。
 * - 既存の候補抽出アルゴリズム（全件を距離でソートし上位N件を取る）を
 *   変更せずに拡張でき、「現在の市区町村＋隣接市区町村」のような
 *   独自の距離しきい値・隣接判定ロジックを新たに設計・検証する必要がない
 *   （単純さと安全性を優先）。
 * そのため、都道府県単位の全候補プールをそのまま距離順にソートする
 * 方式を採用している。
 */
/**
 * 取得済みのShelter[]から、洪水対応の指定緊急避難場所を現在地から近い順に
 * 最大poolSize件選ぶ（純粋関数・ネットワークI/Oなし）。
 * 【重要】supportedDisasters.flood === true のものだけを対象とする。
 * false（明示的に非該当）・"unknown"（指定避難所等、判定材料が無い）は
 * いずれも候補にしない（trueのみを候補とすることで、この3状態を混同しない）。
 */
export function selectFloodCandidates(
  shelters: Shelter[],
  position: { lat: number; lng: number },
  poolSize: number = CANDIDATE_POOL_SIZE
): FloodShelterCandidate[] {
  const floodSites = shelters.filter(
    (s) => s.shelterType === "designated_emergency_evacuation_site" && s.supportedDisasters.flood === true
  );

  const withDistance: FloodShelterCandidate[] = floodSites.map((s) => ({
    id: s.id,
    name: s.name,
    address: s.address ?? "",
    lat: s.lat,
    lng: s.lng,
    straightLineDistanceMeters: haversineDistanceMeters(position, s),
    type: "evacuation_site",
    hazards: s.hazards,
    telephone: s.telephone ?? null,
    availableHours: s.availableHours ?? null,
    ward: s.ward ?? null,
    category: s.category ?? null,
    prefectureCode: s.prefectureCode,
  }));

  withDistance.sort((a, b) => a.straightLineDistanceMeters - b.straightLineDistanceMeters);

  return withDistance.slice(0, poolSize);
}

export async function findFloodShelterCandidates(
  position: { lat: number; lng: number },
  region: Region,
  poolSize: number = CANDIDATE_POOL_SIZE
): Promise<FloodCandidateResult> {
  const result = await getShelters(region);
  if (result.status === "unsupported") return { status: "unsupported" };
  if (result.status === "fetch_error") return { status: "fetch_error" };

  return { status: "ok", candidates: selectFloodCandidates(result.shelters, position, poolSize) };
}
