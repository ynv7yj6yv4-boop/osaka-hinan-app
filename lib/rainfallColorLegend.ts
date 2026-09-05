// 気象庁「高解像度降水ナウキャスト」タイル画像の色 → 降水強度(mm/h)の対応表。
//
// 【この表の根拠と限界（2026-09-06調査）】
// Phase3のハザード色（国交省の一次資料にRGB値が明記されていた）とは異なり、
// 気象庁がこのタイル画像について「このRGB値はこのmm/hである」と明記した
// 一次資料は、調査の結果見つかりませんでした。
//
// そのため、以下3点の状況証拠を組み合わせて表を作成しています。
//
// 1. 実際に配信中のタイル画像（日本各地・複数時刻）から、透明でないピクセルの
//    色を実際に抽出したところ、常に以下の8色のいずれかであることを確認した
//    （架空の値ではなく、実データから確認した色）。
// 2. 気象庁の解説ページで、降水強度が
//    「やや強い雨:10〜20mm/h」「強い雨:20〜30mm/h」「激しい雨:30〜50mm/h」
//    「非常に激しい雨:50〜80mm/h」「猛烈な雨:80mm/h以上」と定義されている
//    （気象庁ホームページの解説ページで確認）。
// 3. 同じ気象庁のタイルデータを表示する第三者サイトが、
//    「0/1/5/10/20/30/50/80mm/hの8段階」という色分けを公開しており、
//    抽出した8色の並び順（薄い青→濃い青→黄→橙→赤→紫）と一致することを確認した。
//
// 【重要】上記は状況証拠の組み合わせであり、気象庁の一次資料による確認では
// ありません。そのため、この値は「約」を付けた目安としてのみ表示し、
// 危険度判定のスコアには使用しません（Phase4Aの設計方針・利用者との合意事項）。
// 将来、気象庁への確認等で正式な対応関係が判明した場合は、この表を更新してください。

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

// 色は判定用に厳密に塗り分けられているとみられるため、許容誤差は小さめにしている
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
