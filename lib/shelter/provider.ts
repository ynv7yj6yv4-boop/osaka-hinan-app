// Phase 3: 避難所データ取得の抽象層。
//
// 【設計方針】MapView.tsx・EvacuationPanel.tsx等のUI層に
// 「if 大阪府 / if 京都府」のような分岐を増やさないため、
// 「都道府県コード → ShelterProvider」の解決だけをこのファイルに閉じ込める。
// UI層は`getShelters(region)`を呼ぶだけでよく、将来 京都府・兵庫県 等の
// Providerを追加する際もUI層の変更は不要（このファイルへの登録のみで済む）。
//
// 【今回のPhaseで実装するのは大阪府のみ】他の都道府県はProviderを登録せず、
// "unsupported"を返す（大阪府のデータを誤って流用しない。既存のRegionCapability
// と同じ安全側の考え方）。

import type { PrefectureCode, Region } from "../region/types.ts";
import type { Shelter } from "./types.ts";
import { getOsakaPrefectureShelters } from "./osakaProvider.ts";

export type GetSheltersResult =
  | { status: "ok"; shelters: Shelter[] }
  | { status: "unsupported" }
  | { status: "fetch_error" };

export type ShelterProvider = {
  getShelters(): Promise<GetSheltersResult>;
};

const PROVIDERS: Partial<Record<PrefectureCode, ShelterProvider>> = {
  "27": { getShelters: getOsakaPrefectureShelters },
};

/**
 * 指定した地域(都道府県)の避難所データを取得する。
 * 都道府県単位でProviderを解決する（市区町村単位の分岐はProvider内部・
 * 呼び出し側の絞り込みロジックが担当し、ここでは行わない）。
 */
export async function getShelters(region: Region): Promise<GetSheltersResult> {
  const provider = PROVIDERS[region.prefectureCode];
  if (!provider) return { status: "unsupported" };
  return provider.getShelters();
}
