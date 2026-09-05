// 指定した緯度経度が、ハザードタイル画像上でどの色になっているかを調べるためのユーティリティ。
// タイル画像は地図表示（Phase2）でも使っているものと同じもの＝再利用。

// 判定用に固定するズームレベル（地図の表示ズームとは独立）。
// 洪水・高潮タイルはズーム2〜17で提供されていることを確認済み。
// 16程度あれば1ピクセルあたり数m程度の精度になる。
export const SAMPLING_ZOOM = 16;

function lngLatToTilePixel(lat: number, lng: number, zoom: number) {
  const n = 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  const xTileFloat = ((lng + 180) / 360) * n;
  const yTileFloat =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const xTile = Math.floor(xTileFloat);
  const yTile = Math.floor(yTileFloat);
  const px = Math.min(255, Math.floor((xTileFloat - xTile) * 256));
  const py = Math.min(255, Math.floor((yTileFloat - yTile) * 256));
  return { xTile, yTile, px, py };
}

export type TileSampleResult =
  | { kind: "pixel"; r: number; g: number; b: number; a: number }
  | { kind: "no_tile" } // タイル自体が存在しない（404）
  | { kind: "error" }; // 通信エラー・画像デコード失敗等

/**
 * 指定URLテンプレート（{z}/{x}/{y}を含む）のタイル画像から、
 * 指定した緯度経度に対応する1ピクセルの色を読み取る。
 *
 * fetch()でいったんバイト列として取得し、blob URL経由でImageに読み込むことで、
 * クロスオリジン画像特有のcanvas汚染（読み取り不可）を回避している。
 */
export async function samplePixelFromTile(
  urlTemplate: string,
  lat: number,
  lng: number,
  zoom: number = SAMPLING_ZOOM
): Promise<TileSampleResult> {
  const { xTile, yTile, px, py } = lngLatToTilePixel(lat, lng, zoom);
  const url = urlTemplate
    .replace("{z}", String(zoom))
    .replace("{x}", String(xTile))
    .replace("{y}", String(yTile));

  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    return { kind: "error" };
  }
  if (res.status === 404) return { kind: "no_tile" };
  if (!res.ok) return { kind: "error" };

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => resolve(null);
      im.src = objectUrl;
    });
    if (!img) return { kind: "error" };

    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { kind: "error" };
    ctx.drawImage(img, 0, 0);

    const data = ctx.getImageData(px, py, 1, 1).data;
    return { kind: "pixel", r: data[0], g: data[1], b: data[2], a: data[3] };
  } catch {
    return { kind: "error" };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
