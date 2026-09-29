// Phase 5: 和歌山県全域の避難所データProvider。
// 生成元は国土地理院 指定緊急避難場所・指定避難所データ（和歌山県内30市町村）。
// data/README.md・scripts/build-shelters.mjs参照。
// 【重要】境界データに存在する"30000 所属未定地"は実在する市町村ではなく、
// GSI側では偶然この県全域の集約データが返ってくるため、取得・変換の
// 両スクリプトで意図的に除外している（詳細はscripts/fetch-shelter-
// source-data.mjs・build-shelters.mjsのコメント参照）。
// 大阪府と同じくcreateJsonShelterProvider()を使う（jsonShelterProvider.ts）。
// 詳細情報拡充ソース（telephone等）は和歌山県に対して調査・導入していないため常にnull。

import { createJsonShelterProvider } from "./jsonShelterProvider.ts";

export const wakayamaShelterProvider = createJsonShelterProvider("/data/wakayama-prefecture-shelters.json");
