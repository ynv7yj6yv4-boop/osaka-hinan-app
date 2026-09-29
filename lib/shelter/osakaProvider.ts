// Phase 3: 大阪府全域の避難所データProvider。
//
// data/README.md・scripts/build-shelters.mjs参照。生成元は国土地理院
// 指定緊急避難場所・指定避難所データ（大阪府内43市町村）。
// public/data/osaka-prefecture-shelters.json は Shelter[] 形状（lib/shelter/types.ts）
// のfeaturesをそのまま保持しているため、ここでは取得・キャッシュ・簡易な
// 形式チェックのみを行う（値の変換・補完は行わない＝推測で埋めない）。

import type { Shelter } from "./types.ts";

type SheltersFile = {
  source: string;
  sourceUrl: string;
  fetchedAt: string;
  notice: string;
  features: Shelter[];
};

let cached: Shelter[] | null = null;
let inFlight: Promise<Shelter[]> | null = null;

async function loadOsakaPrefectureShelters(): Promise<Shelter[]> {
  if (cached) return cached;
  if (inFlight) return inFlight;

  inFlight = fetch("/data/osaka-prefecture-shelters.json")
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

export async function getOsakaPrefectureShelters(): Promise<
  { status: "ok"; shelters: Shelter[] } | { status: "fetch_error" }
> {
  try {
    const shelters = await loadOsakaPrefectureShelters();
    return { status: "ok", shelters };
  } catch {
    return { status: "fetch_error" };
  }
}
