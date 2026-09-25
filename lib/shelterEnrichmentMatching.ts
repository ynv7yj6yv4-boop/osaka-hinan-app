// 避難所詳細情報の拡充: GSIの避難所データと、大阪市オープンデータ
// （マップナビおおさか、電話番号・避難可能時間等）の名寄せロジック。
//
// 【重要・安全側の方針】施設名の完全一致だけに頼らず、
// 「座標が近い(MATCH_MAX_DISTANCE_METERS以内)」かつ「正規化した施設名が
// 一致または包含関係にある」の両方を満たす場合のみ紐付ける。
// 複数のGSI候補があっても、それらの正規化名が全て同じであれば
// (指定緊急避難場所・指定避難所への重複登録など、同一施設とみなせるため)
// 安全に全件へ補完する。正規化名が食い違う場合は「あいまい」として
// 補完せず未マッチのまま残す(誤った電話番号等を付与するくらいなら、
// 情報を表示しない方を優先する)。
//
// I/O(CSV読み込み等)は一切行わない純粋関数のみで構成する
// (scripts/build-shelters.mjsから呼び出される。Node testで直接検証できる)。

export type MatchableGsiFeature = {
  id: string;
  name: string;
  lat: number;
  lng: number;
};

export type CityShelterRecord = {
  name: string;
  lat: number;
  lng: number;
  telephone: string | null;
  availableHours: string | null;
  ward: string | null;
  category: string | null;
};

export type ShelterEnrichment = {
  telephone: string | null;
  availableHours: string | null;
  ward: string | null;
  category: string | null;
};

export type ShelterMatchReport = {
  totalCityRecords: number;
  matchedCount: number;
  unmatchedCount: number;
  ambiguousCount: number;
  /** 候補が2件以上あった件数(あいまい判定になったものも含む)。 */
  multiCandidateCount: number;
  ambiguousSamples: { city: string; gsiCandidates: string[] }[];
};

// 実データ(大阪市1528件・GSI4083件)で60/80/120/150/200mを比較検証し、
// マッチ率(約96%)とあいまい判定件数のバランスが最も良かったため採用。
export const MATCH_MAX_DISTANCE_METERS = 120;

// 「－」「-」「‐」「―」や空文字は、値が無いことを示す表記ゆれとして
// 統一してnullにする(データを生成しない。あくまで表記の正規化のみ)。
const EMPTY_MARKERS = new Set(["", "－", "-", "‐", "―"]);
export function normalizeOptionalText(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  return EMPTY_MARKERS.has(v) ? null : v;
}

// 施設名の表記ゆれ(全角/半角・空白・「（運動場）」等の付記)を吸収するための
// 正規化。名寄せの判定にのみ使い、実際に保存・表示する施設名は変更しない。
export function normalizeNameForMatching(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[\s　]/g, "")
    .trim();
}

export function haversineDistanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function namesMatch(normalizedA: string, normalizedB: string): boolean {
  if (!normalizedA || !normalizedB) return false;
  return (
    normalizedA === normalizedB ||
    normalizedA.includes(normalizedB) ||
    normalizedB.includes(normalizedA)
  );
}

export function matchShelterEnrichment(
  gsiFeatures: MatchableGsiFeature[],
  cityRecords: CityShelterRecord[],
  maxDistanceMeters: number = MATCH_MAX_DISTANCE_METERS
): { enrichmentByGsiId: Map<string, ShelterEnrichment>; report: ShelterMatchReport } {
  const enrichmentByGsiId = new Map<string, ShelterEnrichment>();
  let matchedCount = 0;
  let unmatchedCount = 0;
  let ambiguousCount = 0;
  let multiCandidateCount = 0;
  const ambiguousSamples: { city: string; gsiCandidates: string[] }[] = [];

  for (const city of cityRecords) {
    const cityNameNormalized = normalizeNameForMatching(city.name);
    const candidates = gsiFeatures.filter(
      (f) =>
        haversineDistanceMeters(city, f) <= maxDistanceMeters &&
        namesMatch(normalizeNameForMatching(f.name), cityNameNormalized)
    );

    if (candidates.length === 0) {
      unmatchedCount++;
      continue;
    }
    if (candidates.length > 1) multiCandidateCount++;

    const uniqueNames = new Set(candidates.map((c) => normalizeNameForMatching(c.name)));
    if (uniqueNames.size > 1) {
      ambiguousCount++;
      if (ambiguousSamples.length < 10) {
        ambiguousSamples.push({ city: city.name, gsiCandidates: candidates.map((c) => c.name) });
      }
      continue;
    }

    matchedCount++;
    const enrichment: ShelterEnrichment = {
      telephone: normalizeOptionalText(city.telephone),
      availableHours: normalizeOptionalText(city.availableHours),
      ward: normalizeOptionalText(city.ward),
      category: normalizeOptionalText(city.category),
    };
    for (const c of candidates) {
      enrichmentByGsiId.set(c.id, enrichment);
    }
  }

  return {
    enrichmentByGsiId,
    report: {
      totalCityRecords: cityRecords.length,
      matchedCount,
      unmatchedCount,
      ambiguousCount,
      multiCandidateCount,
      ambiguousSamples,
    },
  };
}
