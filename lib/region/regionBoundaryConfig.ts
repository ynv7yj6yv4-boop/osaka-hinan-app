// 地域判定基盤（Phase 2）: 府県境付近の「判定不能(unknown)」を検出するための
// バッファ距離。1か所で管理し、複数箇所に同じ数値をハードコードしない。
//
// 【重要】この値は実行時の計算パラメータではなく、
// scripts/build-region-boundaries.mjs が
// data/region-boundaries/kinki-prefectures-buffered.geojson を生成する際に
// 使用する（ジオメトリとして事前にバッファ済みのポリゴンを焼き込む）。
// そのため、この値を変更した場合は
// `node scripts/build-region-boundaries.mjs` を再実行し、境界データを
// 再生成しない限り実際の判定結果には反映されない。
//
// 「300m以内は unknown とする」という安全側の方針自体は維持すること
// （府県境付近で誤って一方の県だけに断定しない、という要件の根幹部分）。
export const REGION_BOUNDARY_AMBIGUITY_BUFFER_METERS = 300;
