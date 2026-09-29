// Phase 3/4: 避難所データ取得の抽象層。
//
// 【設計方針】MapView.tsx・EvacuationPanel.tsx等のUI層に
// 「if 大阪府 / if 京都府」のような分岐を増やさないため、
// 「都道府県コード → ShelterProvider」の解決だけをこのファイルに閉じ込める。
// UI層は`getShelters(region)`を呼ぶだけでよく、Providerを追加する際も
// UI層の変更は不要（このファイルへの登録のみで済む）。
//
// 【Phase 4で京都府・兵庫県を追加】大阪府（27）に加え、京都府（26）・
// 兵庫県（28）にもProviderを登録した。いずれも実体は
// createJsonShelterProvider()（jsonShelterProvider.ts）で、都道府県ごとに
// 独立したJSON（例: /data/kyoto-prefecture-shelters.json）をfetchする
// （1つの巨大JSONに統合しない。京都府の利用者が大阪府・兵庫県の
// データまでダウンロードしないようにするため）。
//
// 【滋賀県・奈良県・和歌山県は今回未対応】Providerを登録せず、
// "unsupported"を返す（他県のデータを誤って流用しない。既存の
// RegionCapabilityと同じ安全側の考え方）。

import type { PrefectureCode, Region } from "../region/types.ts";
import type { Shelter } from "./types.ts";
import { osakaShelterProvider } from "./osakaProvider.ts";
import { kyotoShelterProvider } from "./kyotoProvider.ts";
import { hyogoShelterProvider } from "./hyogoProvider.ts";

export type GetSheltersResult =
  | { status: "ok"; shelters: Shelter[] }
  | { status: "unsupported" }
  | { status: "fetch_error" };

export type ShelterProvider = {
  getShelters(): Promise<GetSheltersResult>;
};

const PROVIDERS: Partial<Record<PrefectureCode, ShelterProvider>> = {
  "26": kyotoShelterProvider,
  "27": osakaShelterProvider,
  "28": hyogoShelterProvider,
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
