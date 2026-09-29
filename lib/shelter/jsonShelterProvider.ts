// Phase 4: 都道府県単位の静的JSON（scripts/build-shelters.mjsが生成）を
// fetchするだけのShelterProviderは、大阪府・京都府・兵庫県で構造が完全に
// 同じ（都道府県ごとに違うのはfetch先URLだけ）ため、共通のfactory関数に
// まとめた（osakaProvider.ts・kyotoProvider.ts・hyogoProvider.tsが重複した
// コピーにならないようにするため）。
//
// 【キャッシュの単位】createJsonShelterProvider()の呼び出しごとに独立した
// クロージャ（cached/inFlight）を持つため、都道府県ごとに独立してキャッシュ
// される（大阪府のデータを取得済みでも、京都府のデータは別途fetchする）。

import type { ShelterProvider } from "./provider.ts";
import type { Shelter } from "./types.ts";

type SheltersFile = {
  source: string;
  sourceUrl: string;
  fetchedAt: string;
  notice: string;
  features: Shelter[];
};

export function createJsonShelterProvider(url: string): ShelterProvider {
  let cached: Shelter[] | null = null;
  let inFlight: Promise<Shelter[]> | null = null;

  async function load(): Promise<Shelter[]> {
    if (cached) return cached;
    if (inFlight) return inFlight;

    inFlight = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`避難場所データの取得に失敗しました（status: ${res.status}）`);
        return res.json();
      })
      .then((json: SheltersFile) => {
        cached = json.features;
        return cached;
      })
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  }

  return {
    async getShelters() {
      try {
        const shelters = await load();
        return { status: "ok", shelters };
      } catch {
        return { status: "fetch_error" };
      }
    },
  };
}
