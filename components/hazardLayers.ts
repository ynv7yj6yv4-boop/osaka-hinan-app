// ハザードマップポータルサイト（国土交通省）のタイル配信レイヤー定義
// 出典・利用規約: ../data/README.md を参照

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

export const HAZARD_TILE_URL: Record<HazardKey, string> = {
  flood: "https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png",
  inundation: "https://disaportaldata.gsi.go.jp/raster/02_naisui_pref_data/27/{z}/{x}/{y}.png",
  hightide: "https://disaportaldata.gsi.go.jp/raster/03_hightide_l2_shinsuishin_data/{z}/{x}/{y}.png",
};

export const HAZARD_BUTTONS: { key: HazardKey; label: string; emoji: string }[] = [
  { key: "flood", label: "洪水", emoji: "🌊" },
  { key: "inundation", label: "内水氾濫", emoji: "🌧️" },
  { key: "hightide", label: "高潮", emoji: "🌀" },
];

export const HAZARD_ATTRIBUTION =
  '出典：<a href="https://disaportal.gsi.go.jp/" target="_blank" rel="noopener noreferrer">ハザードマップポータルサイト</a>（国土交通省）';
