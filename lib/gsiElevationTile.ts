// 国土地理院 標高タイル（基盤地図情報数値標高モデル）を、避難ルートの
// 区間別地形評価のために取得するモジュール。
//
// 【重要・単点API連打の禁止】lib/elevation.ts の getelevation.php（1地点=1リクエスト
// の単点標高API）を、ルートのサンプル点ごとに数十〜数百回呼ぶことはしない。
// 代わりに、国土地理院が提供する「標高タイル」（1タイル=256x256地点の標高値を
// まとめて返すテキスト形式）を使い、同じタイルに複数のサンプル点が含まれる
// 場合は1回のリクエストで済ませる（下記のタイルキャッシュ）。
//
// 【出典・実装時点(2026-09-26)での公式仕様確認】
// - 地理院タイル一覧: https://maps.gsi.go.jp/development/ichiran.html
// - 標高タイルの詳細仕様: https://maps.gsi.go.jp/development/demtile.html
// - 標高タイルの作成方法と標高値について: https://maps.gsi.go.jp/development/hyokochi.html
// 上記ページのHTML内に実際に記載されている配信URL
// （https://cyberjapandata.gsi.go.jp/xyz/dem5a/{z}/{x}/{y}.txt 等）を確認し、
// 実際に大阪市内の座標でタイルを取得して動作（256行×256列のカンマ区切り、
// 欠損値は"e"）を検証済み。
//
// 【DEM種別とfallback】地理院地図は「指定した地点において整備されている
// 最も計測精度の良い標高タイルを表示する」方針を取っており(hyokochi.html)、
// 精度順は DEM1A > DEM5A > DEM5B・DEM5C > DEM10B > DEMGM。
// このうちテキスト形式(.txt)で公式に提供されているのは
// DEM5A・DEM5B・DEM10B(シームレス版)の3種のみ(DEM1A・DEM5C・DEMGMはPNG形式のみ
// 確認できた)。未確認のPNGデコード方式を推測実装しないため、
// 今回はテキスト形式の3段階(DEM5A→DEM5B→DEM10B)のみをfallbackとして使う。
// ズームレベルはDEM5A/DEM5B=15、DEM10B(シームレス)=14(hyokochi.htmlに記載)。
//
// 【利用条件】国土地理院コンテンツ利用規約により、Webサイト上でリアルタイムに
// 読み込んで利用する場合は出典の明示のみで申請不要。加工（相対標高の算出等）を
// 行っているため、その旨もあわせて表示する(UI側のAttribution表示を参照)。

export type ElevationSource = "dem5a" | "dem5b" | "dem10b" | "unknown";

type DemTier = {
  source: Exclude<ElevationSource, "unknown">;
  urlTemplate: string;
  zoom: number;
};

const DEM_TIERS: readonly DemTier[] = [
  { source: "dem5a", urlTemplate: "https://cyberjapandata.gsi.go.jp/xyz/dem5a/{z}/{x}/{y}.txt", zoom: 15 },
  { source: "dem5b", urlTemplate: "https://cyberjapandata.gsi.go.jp/xyz/dem5b/{z}/{x}/{y}.txt", zoom: 15 },
  { source: "dem10b", urlTemplate: "https://cyberjapandata.gsi.go.jp/xyz/dem/{z}/{x}/{y}.txt", zoom: 14 },
];

export type DemTileCoord = {
  z: number;
  x: number;
  y: number;
  /** タイル内(256x256)での列位置(0〜255)。 */
  px: number;
  /** タイル内(256x256)での行位置(0〜255)。 */
  py: number;
};

/**
 * 緯度経度を、指定ズームでの標準的なXYZタイル座標＋タイル内ピクセル位置に変換する。
 * lib/tilePixel.ts の lngLatToTilePixel と同じ計算式（Web Mercator）。
 */
export function lngLatToDemTileCoord(lat: number, lng: number, zoom: number): DemTileCoord {
  const n = 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  const xTileFloat = ((lng + 180) / 360) * n;
  const yTileFloat =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const xTile = Math.floor(xTileFloat);
  const yTile = Math.floor(yTileFloat);
  const px = Math.min(255, Math.floor((xTileFloat - xTile) * 256));
  const py = Math.min(255, Math.floor((yTileFloat - yTile) * 256));
  return { z: zoom, x: xTile, y: yTile, px, py };
}

/**
 * 標高タイルのテキスト形式(256行、各行256個のカンマ区切り値)をパースする。
 * 欠損値("e")は null にする（存在しない値を0扱いにしない）。
 */
export function parseDemTileText(text: string): (number | null)[][] {
  return text
    .split("\n")
    .filter((row) => row.length > 0)
    .map((row) =>
      row.split(",").map((cell) => {
        const trimmed = cell.trim();
        if (trimmed === "" || trimmed.toLowerCase() === "e") return null;
        const n = Number(trimmed);
        return Number.isFinite(n) ? n : null;
      })
    );
}

/** fetch()と互換の最小限の型（テストからモックしやすくするため）。 */
export type DemFetchFn = (url: string) => Promise<{ ok: boolean; text: () => Promise<string> }>;

const defaultFetchFn: DemFetchFn = (url) => fetch(url);

/**
 * ルート1本の評価内で共有するタイルキャッシュ。同じタイルへのリクエストは
 * 1回だけ実際にfetchし、以降は同じPromiseを共有する
 * (Map<tileKey, Promise<...>>による request-level cache)。
 * 【重要】ここで作るキャッシュは呼び出し側(ルート評価1回分)のスコープに
 * とどめる。アプリ全体で永続化する巨大キャッシュは今回作らない。
 */
export type ElevationTileCache = Map<string, Promise<(number | null)[][] | null>>;

export function createElevationTileCache(): ElevationTileCache {
  return new Map();
}

function fetchTileGrid(
  tier: DemTier,
  x: number,
  y: number,
  cache: ElevationTileCache,
  fetchFn: DemFetchFn
): Promise<(number | null)[][] | null> {
  const key = `${tier.source}:${tier.zoom}:${x}:${y}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const pending = (async () => {
    try {
      const url = tier.urlTemplate
        .replace("{z}", String(tier.zoom))
        .replace("{x}", String(x))
        .replace("{y}", String(y));
      const res = await fetchFn(url);
      if (!res.ok) return null; // 404等。このDEM種別では未整備の地点として次のtierへ
      const text = await res.text();
      return parseDemTileText(text);
    } catch {
      return null; // ネットワークエラー等。呼び出し側でfallback/unknown扱いにする
    }
  })();
  cache.set(key, pending);
  return pending;
}

export type ElevationLookupResult =
  | { elevationMeters: number; source: Exclude<ElevationSource, "unknown"> }
  | { elevationMeters: null; source: "unknown" };

/**
 * 指定地点の標高を、精度の高いDEMから順にfallbackしながら取得する。
 * タイル取得はcacheを介するため、同じタイルに複数の地点が含まれる場合、
 * 実際のリクエストは1回だけになる。
 *
 * 【重要】ここでの失敗(通信エラー・タイムアウト・全tier未整備)は例外を
 * 投げず、必ず{elevationMeters: null, source: "unknown"}を返す。
 * 標高は付加評価であり、これによってルート表示自体が壊れてはならない。
 */
export async function getElevationAtPoint(
  lat: number,
  lng: number,
  cache: ElevationTileCache,
  fetchFn: DemFetchFn = defaultFetchFn
): Promise<ElevationLookupResult> {
  for (const tier of DEM_TIERS) {
    const coord = lngLatToDemTileCoord(lat, lng, tier.zoom);
    const grid = await fetchTileGrid(tier, coord.x, coord.y, cache, fetchFn);
    if (!grid) continue;
    const row = grid[coord.py];
    const value = row ? row[coord.px] : undefined;
    if (typeof value === "number") {
      return { elevationMeters: value, source: tier.source };
    }
    // 値が"e"(欠損)だった場合も次のtierへfallbackする
  }
  return { elevationMeters: null, source: "unknown" };
}
