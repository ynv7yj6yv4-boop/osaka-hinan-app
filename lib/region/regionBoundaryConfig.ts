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

// Phase 6 PART B: 府県境を越えた避難先候補検索のための距離。
// 現在地が「隣接府県の領域からこの距離以内」の場合のみ、隣接府県の
// ShelterProviderも取得して候補プールに含める（詳細はlib/shelter/
// crossPrefectureSearch.ts参照）。
//
// 【採用理由】近畿2府4県は府県境が非常に多く（6県が密接に隣り合う）、
// 大きすぎる値にすると「常にどこかの隣接府県が範囲内」になりやすく、
// 「近畿6府県すべてを無条件ロードすることを禁止する」という要件と
// 実質的に矛盾してしまう。一方、小さすぎると府県境のすぐ近くでも隣接府県の
// より近い候補を見落とす。都市部の指定緊急避難場所密度（大阪府で約1件/
// 0.34km²、平均間隔500m台）を踏まえ、「徒歩数十分以内に隣接府県の候補が
// あり得る範囲」として3kmを採用した。この値を変更した場合は
// `node scripts/build-region-boundaries.mjs` を再実行し、
// kinki-prefectures-buffered-cross-search.geojson を再生成すること
// （REGION_BOUNDARY_AMBIGUITY_BUFFER_METERSと同様、事前にバッファ済みの
// ジオメトリとして焼き込まれるため）。
export const CROSS_PREFECTURE_SEARCH_DISTANCE_METERS = 3000;
