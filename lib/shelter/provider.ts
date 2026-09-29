// Phase 3/4: 避難所データ取得の抽象層。
//
// 【設計方針】MapView.tsx・EvacuationPanel.tsx等のUI層に
// 「if 大阪府 / if 京都府」のような分岐を増やさないため、
// 「都道府県コード → ShelterProvider」の解決だけをこのファイルに閉じ込める。
// UI層は`getShelters(prefectureCode)`を呼ぶだけでよく、Providerを追加する際も
// UI層の変更は不要（このファイルへの登録のみで済む）。
//
// 【Phase 6 PART B】引数をRegion全体ではなくprefectureCodeのみに変更した
// （このファイルが実際に使うのはprefectureCodeだけであり、府県境検索
// （lib/shelter/crossPrefectureSearch.ts）で隣接府県のデータも取得する際、
// 隣接県分のダミーRegionを作らずに済むようにするため）。
//
// 【Phase 4で京都府・兵庫県、Phase 5で滋賀県・奈良県・和歌山県を追加】
// これで近畿2府4県すべて（25〜30）にProviderが登録された。いずれも実体は
// createJsonShelterProvider()（jsonShelterProvider.ts）で、都道府県ごとに
// 独立したJSON（例: /data/kyoto-prefecture-shelters.json）をfetchする
// （1つの巨大JSONに統合しない。京都府の利用者が大阪府・兵庫県の
// データまでダウンロードしないようにするため）。
//
// 【三重県等、近畿2府4県の外は今回も未対応】Providerを登録せず、
// "unsupported"を返す（他県のデータを誤って流用しない。既存の
// RegionCapabilityと同じ安全側の考え方）。

import type { PrefectureCode } from "../region/types.ts";
import type { Shelter } from "./types.ts";
import { shigaShelterProvider } from "./shigaProvider.ts";
import { kyotoShelterProvider } from "./kyotoProvider.ts";
import { osakaShelterProvider } from "./osakaProvider.ts";
import { hyogoShelterProvider } from "./hyogoProvider.ts";
import { naraShelterProvider } from "./naraProvider.ts";
import { wakayamaShelterProvider } from "./wakayamaProvider.ts";

export type GetSheltersResult =
  | { status: "ok"; shelters: Shelter[] }
  | { status: "unsupported" }
  | { status: "fetch_error" };

export type ShelterProvider = {
  getShelters(): Promise<GetSheltersResult>;
};

const PROVIDERS: Partial<Record<PrefectureCode, ShelterProvider>> = {
  "25": shigaShelterProvider,
  "26": kyotoShelterProvider,
  "27": osakaShelterProvider,
  "28": hyogoShelterProvider,
  "29": naraShelterProvider,
  "30": wakayamaShelterProvider,
};

/**
 * 指定した都道府県の避難所データを取得する。
 * 都道府県単位でProviderを解決する（市区町村単位の分岐はProvider内部・
 * 呼び出し側の絞り込みロジックが担当し、ここでは行わない）。
 */
export async function getShelters(prefectureCode: PrefectureCode): Promise<GetSheltersResult> {
  const provider = PROVIDERS[prefectureCode];
  if (!provider) return { status: "unsupported" };
  return provider.getShelters();
}
