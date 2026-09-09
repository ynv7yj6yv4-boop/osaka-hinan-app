// 【重要・保守メモ】このファイルはNext.jsアプリ側の lib/rainfallColorLegend.ts と
// 内容を同期させること。Firebase Functionsは独立したデプロイ単位のため、
// モノレポ共有パッケージ化はせず、意図的にこの小さな純粋ファイルのみ
// コピーしている（notificationDecisionConfig.tsと同じ方針）。判定ロジック自体は
// 一切変更していない（コピーのみ）。出典・検証記録はNext.jsアプリ側を参照。

export type RainfallColorMatch =
  | { matched: true; rank: number; label: string }
  | { matched: false };

const RAINFALL_LEGEND: readonly { rgb: readonly [number, number, number]; rank: number; label: string }[] = [
  { rgb: [242, 242, 255], rank: 1, label: "1mm/h未満（ごく弱い雨）程度" },
  { rgb: [160, 210, 255], rank: 2, label: "1〜5mm/h程度" },
  { rgb: [33, 140, 255], rank: 3, label: "5〜10mm/h程度" },
  { rgb: [0, 65, 255], rank: 4, label: "10〜20mm/h程度（やや強い雨）" },
  { rgb: [250, 245, 0], rank: 5, label: "20〜30mm/h程度（強い雨）" },
  { rgb: [255, 153, 0], rank: 6, label: "30〜50mm/h程度（激しい雨）" },
  { rgb: [255, 40, 0], rank: 7, label: "50〜80mm/h程度（非常に激しい雨）" },
  { rgb: [180, 0, 104], rank: 8, label: "80mm/h以上程度（猛烈な雨）" },
] as const;

const MAX_COLOR_DISTANCE = 30;

export function matchRainfallColor(r: number, g: number, b: number): RainfallColorMatch {
  let best: (typeof RAINFALL_LEGEND)[number] | null = null;
  let bestDist = Infinity;
  for (const entry of RAINFALL_LEGEND) {
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
