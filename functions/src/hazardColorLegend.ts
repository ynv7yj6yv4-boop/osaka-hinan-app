// 【重要・保守メモ】このファイルはNext.jsアプリ側の lib/hazardColorLegend.ts と
// 内容を同期させること。Firebase Functionsは独立したデプロイ単位(それぞれ別の
// node_modulesを持つ)のため、モノレポ共有パッケージ化はせず、意図的にこの
// 小さな純粋ファイルのみコピーしている（notificationDecisionConfig.tsと同じ方針）。
// 変更する場合は両方のファイルを同時に更新すること。判定ロジック自体は
// 一切変更していない（コピーのみ）。
//
// ハザードマップポータルサイトの浸水深タイル画像で使われている色の凡例。
// 出典・検証記録はNext.jsアプリ側の lib/hazardColorLegend.ts を参照。

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
