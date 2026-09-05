// ハザードマップポータルサイトの浸水深タイル画像で使われている色の凡例。
//
// 出典: 国土交通省の資料に記載された標準凡例。
// 2026-09-06、実際に配信されているタイル画像からピクセル色を抽出し、
// 以下の色が実データと一致することを確認済み（架空の数値ではない）。
//   - (247,245,169) 0.5m未満 … 検出済み
//   - (255,216,192) 0.5〜3.0m … 検出済み
//   - (255,183,183) 3.0〜5.0m … 検出済み
//   - (255,145,145) 5.0〜10.0m … 検出済み
//   - (242,133,201) 10.0〜20.0m … 未検出（大阪市内の検証範囲になかったため）
//   - (220,122,220) 20.0m以上 … 未検出（同上）

export type DepthRank = 0 | 1 | 2 | 3 | 4 | 5;

type LegendEntry = {
  rgb: readonly [number, number, number];
  rank: DepthRank;
  label: string;
};

export const DEPTH_LEGEND: readonly LegendEntry[] = [
  { rgb: [247, 245, 169], rank: 1, label: "0.5m未満" },
  { rgb: [255, 216, 192], rank: 2, label: "0.5m〜3.0m" },
  { rgb: [255, 183, 183], rank: 3, label: "3.0m〜5.0m" },
  { rgb: [255, 145, 145], rank: 4, label: "5.0m〜10.0m" },
  { rgb: [242, 133, 201], rank: 5, label: "10.0m〜20.0m" },
  { rgb: [220, 122, 220], rank: 5, label: "20.0m以上" },
];

// 凡例と完全一致しない場合でも、圧縮ノイズ・アンチエイリアスを考慮して
// 一番近い色を採用する（明らかに違う色まで拾わないよう距離の上限を設ける）
const MAX_COLOR_DISTANCE = 60;

export type ColorMatchResult =
  | { matched: true; rank: DepthRank; label: string }
  | { matched: false };

export function matchDepthColor(r: number, g: number, b: number): ColorMatchResult {
  let best: LegendEntry | null = null;
  let bestDist = Infinity;
  for (const entry of DEPTH_LEGEND) {
    const [er, eg, eb] = entry.rgb;
    const dist = Math.sqrt((r - er) ** 2 + (g - eg) ** 2 + (b - eb) ** 2);
    if (dist < bestDist) {
      bestDist = dist;
      best = entry;
    }
  }
  if (best && bestDist <= MAX_COLOR_DISTANCE) {
    return { matched: true, rank: best.rank, label: best.label };
  }
  return { matched: false };
}
