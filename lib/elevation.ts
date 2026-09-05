// 国土地理院 標高API
// https://maps.gsi.go.jp/development/elevation_s.html
// 出典: 国土地理院。利用規約: https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html
// 無料・APIキー不要。ただし過度な連続アクセスは禁止（1操作につき1回のみ呼び出す）。

export type ElevationResult =
  | { available: true; elevation: number; source: string }
  | { available: false };

export async function fetchElevation(lat: number, lng: number): Promise<ElevationResult> {
  try {
    const url = `https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php?lat=${lat}&lon=${lng}&outtype=JSON`;
    const res = await fetch(url);
    if (!res.ok) return { available: false };
    const json = await res.json();
    // 海上など標高データが無い地点では elevation が "-----" という文字列で返る
    if (typeof json.elevation !== "number") return { available: false };
    return { available: true, elevation: json.elevation, source: String(json.hsrc ?? "") };
  } catch {
    return { available: false };
  }
}
