// Phase 4: 京都府全域の避難所データProvider。
// 生成元は国土地理院 指定緊急避難場所・指定避難所データ（京都府内26市町村）。
// data/README.md・scripts/build-shelters.mjs参照。
// 大阪府と同じくcreateJsonShelterProvider()を使う（jsonShelterProvider.ts）。
// 【重要】大阪市オープンデータ相当の詳細情報拡充ソースは京都府に対して
// 調査・導入していないため、telephone/availableHours/ward/category は
// 常にnull（推測で埋めない）。

import { createJsonShelterProvider } from "./jsonShelterProvider.ts";

export const kyotoShelterProvider = createJsonShelterProvider("/data/kyoto-prefecture-shelters.json");
