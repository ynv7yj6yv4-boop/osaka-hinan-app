// Phase 5: 奈良県全域の避難所データProvider。
// 生成元は国土地理院 指定緊急避難場所・指定避難所データ（奈良県内39市町村すべて）。
// data/README.md・scripts/build-shelters.mjs参照。
// 大阪府と同じくcreateJsonShelterProvider()を使う（jsonShelterProvider.ts）。
// 詳細情報拡充ソース（telephone等）は奈良県に対して調査・導入していないため常にnull。

import { createJsonShelterProvider } from "./jsonShelterProvider.ts";

export const naraShelterProvider = createJsonShelterProvider("/data/nara-prefecture-shelters.json");
