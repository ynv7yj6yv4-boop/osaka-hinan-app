// ハザードマップポータルサイト（国土交通省）のタイル配信レイヤー定義
// 出典・利用規約: ../data/README.md を参照

import type { PrefectureCode } from "@/lib/region/types";

export type HazardKey = "flood" | "inundation" | "hightide";

export const HAZARD_LABELS: Record<
  "flood" | "landslide" | "hightide" | "earthquake" | "tsunami" | "fire" | "inundation" | "volcano",
  string
> = {
  flood: "洪水",
  landslide: "土砂災害",
  hightide: "高潮",
  earthquake: "地震",
  tsunami: "津波",
  fire: "大規模な火事",
  inundation: "内水氾濫",
  volcano: "火山現象",
};

// 【Phase 6】内水氾濫はアプリ全体で現行の対象外のため、以下のURLは現在
// どこからもリクエストされない（将来の再導入に備えて残している）。
// 地域判定基盤（Phase 2）: 内水浸水想定区域は都道府県ごとに個別配信されている
// （lib/region/inlandFloodAvailability.ts参照。都道府県コードが存在する＝
// その県全域でデータが使えるとは限らない）。以前は大阪府コード"27"を
// 直書きしていたが、将来他県のタイルも参照できるよう関数化した。
// 【重要】HAZARD_TILE_URL.inundationの値自体は
// getInundationTileUrl("27")と完全に同一の文字列であり、既存の動作
// （地図上に表示されるハザードは引き続き大阪府のもの）は変更していない。
// 実際に他県のタイルへ切り替える配線は今回のPhaseでは行わない。
export function getInundationTileUrl(prefectureCode: PrefectureCode): string {
  return `https://disaportaldata.gsi.go.jp/raster/02_naisui_pref_data/${prefectureCode}/{z}/{x}/{y}.png`;
}

export const HAZARD_TILE_URL: Record<HazardKey, string> = {
  flood: "https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png",
  inundation: getInundationTileUrl("27"),
  hightide: "https://disaportaldata.gsi.go.jp/raster/03_hightide_l2_shinsuishin_data/{z}/{x}/{y}.png",
};

export const HAZARD_BUTTONS: { key: HazardKey; label: string; emoji: string }[] = [
  { key: "flood", label: "洪水", emoji: "🌊" },
  { key: "inundation", label: "内水氾濫", emoji: "🌧️" },
  { key: "hightide", label: "高潮", emoji: "🌀" },
];

export const HAZARD_ATTRIBUTION =
  '出典：<a href="https://disaportal.gsi.go.jp/" target="_blank" rel="noopener noreferrer">ハザードマップポータルサイト</a>（国土交通省）';

// 避難所データのhazards配列(GSIの8種の災害種別コード)を、日本語ラベルの
// 配列に変換する共通ヘルパー。HAZARD_LABELSに無いキーは黙って除外する
// (存在しない災害種別を勝手に補わない)。
export function toHazardLabels(hazards: string[]): string[] {
  return hazards
    .map((h) => HAZARD_LABELS[h as keyof typeof HAZARD_LABELS])
    .filter((label): label is string => Boolean(label));
}
