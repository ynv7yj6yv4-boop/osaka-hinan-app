// Phase6 / 6.1: 現在地と大阪市の位置関係についての簡易チェック。
//
// 【重要】大阪市の正確な行政区域データは保有していないため、行政区域の
// 判定は行わない（推測で区域判定を作らない、というユーザーとの合意）。
// ここでは「大阪市とその周辺を十分に含む、明らかに緩い矩形」を使い、
// 矩形の外側にある場合にのみ「明らかに対象地域外の可能性が高い」と判定する。
//
// 【Phase6.1で修正した点】
// Phase6時点では「矩形の外側」のときだけ案内を表示し、「矩形の内側」の
// 場合は何も表示していなかった。しかし、矩形は大阪市を十分に囲むよう
// 緩く取っているため、豊中市役所・堺市役所など、大阪市**ではない**
// 近隣自治体の地点も矩形内に入ってしまうことを実地点で確認した
// （実装ミスではなく、行政区域データを持たないことによる構造的な限界）。
// そのため、判定結果を2値(true/false)ではなく3値にし、
// 「矩形内＝大阪市内」であるとは呼び出し側が絶対に解釈できないようにした。
export type OsakaAreaCheckResult =
  | "likely_osaka_or_nearby" // 矩形内。大阪市内である保証は一切ない
  | "clearly_outside"; // 矩形の外側。大阪市から明らかに離れている可能性が高い

// 大阪市（北端 淀川区・東淀川区付近〜南端 平野区・住之江区付近、
// 西端 此花区・住之江区付近〜東端 生野区・平野区付近）を十分に囲む、
// 大きめの緩衝込みの矩形。豊中市・守口市・八尾市・堺市の一部等、
// 隣接自治体もこの矩形に含まれうる（意図的に緩くしているため）。
const LOOSE_BOUNDS = {
  minLat: 34.55,
  maxLat: 34.82,
  minLng: 135.38,
  maxLng: 135.65,
};

export function checkOsakaArea(lat: number, lng: number): OsakaAreaCheckResult {
  const outside =
    lat < LOOSE_BOUNDS.minLat ||
    lat > LOOSE_BOUNDS.maxLat ||
    lng < LOOSE_BOUNDS.minLng ||
    lng > LOOSE_BOUNDS.maxLng;
  return outside ? "clearly_outside" : "likely_osaka_or_nearby";
}

/**
 * @deprecated Phase6.1以降は checkOsakaArea() を使用すること。
 * 後方互換のために残しているが、"false"（矩形内）を「大阪市内」と
 * 解釈しないよう注意（大阪市ではない隣接自治体も矩形内に含まれるため）。
 */
export function isLikelyOutsideOsakaArea(lat: number, lng: number): boolean {
  return checkOsakaArea(lat, lng) === "clearly_outside";
}
