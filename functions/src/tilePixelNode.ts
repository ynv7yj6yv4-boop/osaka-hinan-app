// 要件定義書3「方式A」: lib/tilePixel.ts のNode.js(Cloud Functions)版。
//
// 【重要・保守メモ】タイル座標計算(lngLatToTilePixel)は
// lib/tilePixel.ts と完全に同じ式であり、意図的に複製している
// (notificationDecisionConfig.tsと同じ方針。Firebase Functionsは独立した
// デプロイ単位のため、モノレポ共有パッケージ化はしていない)。
// 変更する場合は両方のファイルを同時に更新すること。
//
// 【方式A・唯一の実質的な変更点】
// lib/tilePixel.ts はブラウザの Canvas/Image/URL.createObjectURL に依存して
// PNGをデコードしているが、Node.js環境にはこれらのAPIが無い。ここでは
// 代わりに pngjs（Node.js用の純粋なPNGデコードライブラリ）でデコードする。
// 座標計算・戻り値の型(TileSampleResult)・404/エラーの扱いは
// lib/tilePixel.ts と完全に同一の規約を維持し、新しい判定ロジックは
// 一切作らない(既存ルールをそのままNode.js上で再現するだけ)。

import { PNG } from "pngjs";

// 判定用に固定するズームレベル。lib/tilePixel.tsのSAMPLING_ZOOMと同じ値。
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

// lib/tilePixel.ts の TileSampleResult と完全に同じ形。
export type TileSampleResult =
  | { kind: "pixel"; r: number; g: number; b: number; a: number }
  | { kind: "no_tile" } // タイル自体が存在しない（404）
  | { kind: "error" }; // 通信エラー・画像デコード失敗等

/**
 * 指定URLテンプレート（{z}/{x}/{y}を含む）のタイル画像から、
 * 指定した緯度経度に対応する1ピクセルの色を読み取る（Node.js版）。
 *
 * lib/tilePixel.ts の samplePixelFromTile() と、404/エラーの解釈・座標計算は
 * 完全に同じ規約。デコード手段のみ pngjs に置き換えている。
 */
export async function samplePixelFromTileNode(
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

  try {
    const arrayBuffer = await res.arrayBuffer();
    const png = PNG.sync.read(Buffer.from(arrayBuffer));
    if (px >= png.width || py >= png.height) return { kind: "error" };

    const idx = (png.width * py + px) << 2;
    return {
      kind: "pixel",
      r: png.data[idx],
      g: png.data[idx + 1],
      b: png.data[idx + 2],
      a: png.data[idx + 3],
    };
  } catch {
    return { kind: "error" };
  }
}
