// Phase 5A: 洪水を対象とした避難先候補の抽出
// Phase 3（地域拡張）: 大阪市専用のJSON直接fetchから、
// lib/shelter/provider.ts（都道府県単位のShelterProvider）経由の
// 取得へ一般化した。UI層（EvacuationPanel.tsx等）が使う
// FloodShelterCandidate型・findFloodShelterCandidates()のシグネチャの
// 意味合いは変えていない（検索対象の府県を追加の引数として受け取る点のみ変更）。
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
// - Phase 6 PART B: 府県境付近では隣接府県のデータも同じ候補プールに入れる
//   （検索対象府県の決定はlib/shelter/crossPrefectureSearch.ts）。
//   市境と同じく、府県境をまたぐかどうかで順位を変えない。

import { getShelters, type GetSheltersResult } from "./shelter/provider.ts";
import type { ShelterSearchScope } from "./shelter/crossPrefectureSearch.ts";
import type { PrefectureCode } from "./region/types.ts";
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
  /** Phase 6 PART B: 府県境検索で隣接府県の候補も並ぶため、候補カードに
   *  「奈良県 生駒市」のような所在地を表示する。元データに無ければnull。 */
  prefectureName: string | null;
  municipalityName: string | null;
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
  | {
      status: "ok";
      candidates: FloodShelterCandidate[];
      /** Phase 6 PART B: 実際にデータを取得できた検索対象府県。 */
      searchedPrefectureCodes: PrefectureCode[];
      /** Phase 6 PART B: 取得に失敗した隣接府県（現在府県の失敗はfetch_errorになる）。 */
      failedPrefectureCodes: PrefectureCode[];
    }
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
    prefectureName: s.prefectureName ?? null,
    municipalityName: s.municipalityName ?? null,
  }));

  withDistance.sort((a, b) => a.straightLineDistanceMeters - b.straightLineDistanceMeters);

  return withDistance.slice(0, poolSize);
}

/** getShelters()と同じシグネチャ。テストで「どの府県のProviderが呼ばれたか」を
 *  検証できるよう、findFloodShelterCandidates()へ差し替え可能にしている。 */
export type ShelterFetcher = (prefectureCode: PrefectureCode) => Promise<GetSheltersResult>;

/**
 * 検索対象府県（lib/shelter/crossPrefectureSearch.tsのShelterSearchScope）の
 * 避難所データをまとめて取得し、府県を区別せず距離順に候補を選ぶ
 * （Phase 6 PART B）。
 *
 * 【ランキング】府県が違っても既存のselectFloodCandidates()をそのまま共通利用し、
 * 行政区域を理由にしたペナルティは付けない（重要なのは距離・洪水対応指定であり、
 * 府県境をまたぐかどうかではない）。
 *
 * 【取得失敗時の安全側の扱い】
 * - 現在の府県（primaryPrefectureCode）の取得に失敗した場合はfetch_error
 *   （隣接府県の候補だけを「近い順」として見せると、実際にはより近い
 *   現在府県の候補を見落とした一覧になるため）。
 * - boundary_ambiguity（現在の府県を確定できない）では、いずれか1府県でも
 *   失敗したらfetch_error（どちらが現在の府県か分からない以上、
 *   片方だけの候補を「近い順」として見せない）。
 * - 隣接府県の取得だけが失敗した場合は、現在の府県の候補を表示しつつ、
 *   failedPrefectureCodesでその旨をUIに伝える。
 */
export async function findFloodShelterCandidates(
  position: { lat: number; lng: number },
  scope: ShelterSearchScope,
  poolSize: number = CANDIDATE_POOL_SIZE,
  fetchShelters: ShelterFetcher = getShelters
): Promise<FloodCandidateResult> {
  const results = await Promise.all(
    scope.prefectureCodes.map(async (code) => ({ code, result: await fetchShelters(code) }))
  );

  const primary = scope.primaryPrefectureCode;
  const primaryResult = primary ? results.find((r) => r.code === primary)?.result : undefined;
  if (primaryResult?.status === "unsupported") return { status: "unsupported" };
  if (primaryResult?.status === "fetch_error") return { status: "fetch_error" };

  const failedPrefectureCodes = results.filter((r) => r.result.status !== "ok").map((r) => r.code);
  if (primary === null && failedPrefectureCodes.length > 0) return { status: "fetch_error" };

  const shelters = results.flatMap((r) => (r.result.status === "ok" ? r.result.shelters : []));
  return {
    status: "ok",
    candidates: selectFloodCandidates(shelters, position, poolSize),
    searchedPrefectureCodes: results.filter((r) => r.result.status === "ok").map((r) => r.code),
    failedPrefectureCodes,
  };
}
