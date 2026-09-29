// Phase 5: 滋賀県全域の避難所データProvider。
// 生成元は国土地理院 指定緊急避難場所・指定避難所データ（滋賀県内19市町村）。
// data/README.md・scripts/build-shelters.mjs参照。
// 【重要】近江八幡市（25204）は指定避難所データのみ公開、甲良町（25442）は
// 指定緊急避難場所データのみ公開（GSI公式サイトに明記された既知の欠落。
// data/README.md参照。データ取得の不具合ではない）。
// 大阪府と同じくcreateJsonShelterProvider()を使う（jsonShelterProvider.ts）。
// 詳細情報拡充ソース（telephone等）は滋賀県に対して調査・導入していないため常にnull。

import { createJsonShelterProvider } from "./jsonShelterProvider.ts";

export const shigaShelterProvider = createJsonShelterProvider("/data/shiga-prefecture-shelters.json");
