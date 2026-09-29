// Phase 3: 大阪府全域の避難所データProvider。
// Phase 4: 実体はcreateJsonShelterProvider()（jsonShelterProvider.ts）へ
// 一般化した（大阪府・京都府・兵庫県で同じfetch/キャッシュ構造のため）。
//
// data/README.md・scripts/build-shelters.mjs参照。生成元は国土地理院
// 指定緊急避難場所・指定避難所データ（大阪府内43市町村）。
// public/data/osaka-prefecture-shelters.json は Shelter[] 形状（lib/shelter/types.ts）
// のfeaturesをそのまま保持している。

import { createJsonShelterProvider } from "./jsonShelterProvider.ts";

export const osakaShelterProvider = createJsonShelterProvider("/data/osaka-prefecture-shelters.json");
