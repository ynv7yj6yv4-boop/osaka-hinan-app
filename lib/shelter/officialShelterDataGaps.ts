// Phase 6 PART D: 国土地理院が公式に「提供していない」と明記している
// 避難所データ種別の一覧（ダウンロードページ「データ整備状況の特筆事項」欄。
// Phase 5で確認済み。data/README.md「Phase 5」参照）。取得処理の不具合ではない。
//
// scripts/build-shelters.mjs（ビルド時の検証）と lib/shelter/dataCompleteness.ts
// （アプリでの表示）の両方から参照するため、生成ファイルに依存しない独立した
// ファイルにしている。

import type { MunicipalityCode } from "../region/types.ts";

export type ShelterDatasetKey = "emergencyEvacuationSites" | "designatedShelters";

export const OFFICIALLY_NOT_PROVIDED: Readonly<Record<MunicipalityCode, readonly ShelterDatasetKey[]>> = {
  "25204": ["emergencyEvacuationSites"], // 滋賀県近江八幡市: 指定避難所データのみ公開
  "25442": ["designatedShelters"], // 滋賀県甲良町: 指定緊急避難場所データのみ公開
};
