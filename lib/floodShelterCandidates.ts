// Phase 5A: 洪水を対象とした避難先候補の抽出
//
// 【方針（ユーザーとの合意事項）】
// - 対象災害は洪水のみ。高潮・内水氾濫はPhase5Bで別途設計する。
// - 候補は type === "evacuation_site" かつ hazards に "flood" を含むものだけを対象とする。
//   type === "shelter"（指定避難所）への自動フォールバックは行わない。
// - 候補地点がハザードマップ上どうであれ、大阪市の公式な洪水対応指定を
//   アプリ側の判定で上書き・除外しない（候補地点自体のハザード判定は
//   Phase5Aでは行わない。表示するとしても「参考情報」であることを明確にし、
//   絞り込みには使わない）。
// - 「最適な避難先」を自動決定するのではなく、近い順の候補プールを提示し、
//   最終的にどこへ行くかはユーザーが選択する。

export type ShelterFeature = {
  id: string;
  type: "shelter" | "evacuation_site";
  name: string;
  address: string;
  lat: number;
  lng: number;
  hazards: string[];
};

export type FloodShelterCandidate = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  /** 現在地からの直線距離（メートル）。道なりの距離ではないことに注意 */
  straightLineDistanceMeters: number;
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

let cachedShelters: ShelterFeature[] | null = null;

async function loadShelters(): Promise<ShelterFeature[]> {
  if (cachedShelters) return cachedShelters;
  const res = await fetch("/data/osaka-shelters.json");
  if (!res.ok) throw new Error("避難場所データの取得に失敗しました");
  const json = await res.json();
  cachedShelters = json.features as ShelterFeature[];
  return cachedShelters;
}

export type FloodCandidateResult =
  | { status: "ok"; candidates: FloodShelterCandidate[] }
  | { status: "fetch_error" };

/**
 * 現在地から近い順に、洪水対応の指定緊急避難場所を最大 CANDIDATE_POOL_SIZE 件返す。
 * 「最適な1件」を決定するものではなく、候補プールを提示するのみ。
 */
export async function findFloodShelterCandidates(
  position: { lat: number; lng: number },
  poolSize: number = CANDIDATE_POOL_SIZE
): Promise<FloodCandidateResult> {
  let shelters: ShelterFeature[];
  try {
    shelters = await loadShelters();
  } catch {
    return { status: "fetch_error" };
  }

  const floodSites = shelters.filter(
    (s) => s.type === "evacuation_site" && s.hazards.includes("flood")
  );

  const withDistance: FloodShelterCandidate[] = floodSites.map((s) => ({
    id: s.id,
    name: s.name,
    address: s.address,
    lat: s.lat,
    lng: s.lng,
    straightLineDistanceMeters: haversineDistanceMeters(position, s),
  }));

  withDistance.sort((a, b) => a.straightLineDistanceMeters - b.straightLineDistanceMeters);

  return { status: "ok", candidates: withDistance.slice(0, poolSize) };
}
