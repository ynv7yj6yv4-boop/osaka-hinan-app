// Phase 6 PART C: 位置情報取得前の初期地図表示範囲（近畿2府4県全体）を、
// 行政区域データ（data/region-boundaries/kinki-municipalities.geojson、
// 国土数値情報N03由来）から算出して lib/region/kinkiBounds.generated.ts に書き出す。
// 大阪市役所等の固定座標を別の固定座標へ置き換えるのではなく、境界データから
// 機械的に求めることで、対象府県の範囲と初期表示範囲が食い違わないようにする。
//
// ネットワークアクセスは不要（既存の境界データを読むだけ）。
// scripts/build-region-boundaries.mjs の最後にも自動的に実行される。
//
// 実行方法: node scripts/build-kinki-bounds.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { coordEach } from "@turf/meta";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

export function buildKinkiBounds() {
  const municipalities = JSON.parse(
    readFileSync(path.join(rootDir, "data", "region-boundaries", "kinki-municipalities.geojson"), "utf-8")
  );
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  coordEach(municipalities, ([lng, lat]) => {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lng);
    east = Math.max(east, lng);
  });

  const round = (v) => Number(v.toFixed(4));
  const source = [
    "// このファイルは scripts/build-kinki-bounds.mjs が自動生成する（手で編集しないこと）。",
    "// 近畿2府4県（滋賀・京都・大阪・兵庫・奈良・和歌山）の行政区域全体の外接矩形",
    "// （data/region-boundaries/kinki-municipalities.geojson から算出）。",
    "// [[南端の緯度, 西端の経度], [北端の緯度, 東端の経度]]（LeafletのLatLngBoundsExpression形式）。",
    "",
    `export const KINKI_BOUNDS: [[number, number], [number, number]] = [[${round(south)}, ${round(west)}], [${round(north)}, ${round(east)}]];`,
    "",
  ].join("\n");
  const outPath = path.join(rootDir, "lib", "region", "kinkiBounds.generated.ts");
  writeFileSync(outPath, source, "utf-8");
  return outPath;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log("書き出し完了:", buildKinkiBounds());
}
