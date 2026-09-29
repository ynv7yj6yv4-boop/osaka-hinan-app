// Phase 6 PART D: 市区町村単位の避難所データ提供状況（ShelterDataCompleteness）。
//
// 【RegionCapabilityとの違い】RegionCapability.shelter（lib/region/capability.ts）は
// 「その都道府県の避難所データをProvider経由で取得してよいか」だけを表し、
// 公式データが揃っていることは意味しない。「supported＝完全」という誤解を
// 避けるため、市区町村ごとの提供状況はこのファイルで別に表現する。
//
// 【"complete"という名前を使わない理由】「国土地理院から両方のCSVを取得できた」
// ことは、「その市町村のすべての避難所・避難場所が漏れなく登録されている」ことまでは
// 保証しない（公式データ自体、各市町村の登録情報であり「最新でない場合や
// 未掲載の場合がある」と利用上の注意に明記されている。data/raw/gsi-notice.txt）。
// そのため各データ種別の状態は"available"（公式に提供され、取得できた）と呼び、
// "complete"とは呼ばない。
//
// 【各状態の根拠】
// - "available": scripts/build-shelters.mjsが実際にそのCSVを読み込めた
//   （shelterDatasetPresence/*.generated.tsに記録。推測で埋めない）。
// - "unavailable": 国土地理院の公式ダウンロードページ「データ整備状況の特筆事項」
//   欄に、提供されていないことが明記されているもの（officialShelterDataGaps.ts）。
//   CSVが手元に無いだけでは"unavailable"にしない（取得失敗と区別できないため）。
// - "unknown": 上記いずれでもない（市区町村が判定できない、データが無い理由が
//   公式に確認できない等）。

import type { MunicipalityCode } from "../region/types.ts";
import { OFFICIALLY_NOT_PROVIDED, type ShelterDatasetKey } from "./officialShelterDataGaps.ts";
import { SHIGA_SHELTER_DATASET_PRESENCE } from "./shelterDatasetPresence/shiga.generated.ts";
import { KYOTO_SHELTER_DATASET_PRESENCE } from "./shelterDatasetPresence/kyoto.generated.ts";
import { OSAKA_SHELTER_DATASET_PRESENCE } from "./shelterDatasetPresence/osaka.generated.ts";
import { HYOGO_SHELTER_DATASET_PRESENCE } from "./shelterDatasetPresence/hyogo.generated.ts";
import { NARA_SHELTER_DATASET_PRESENCE } from "./shelterDatasetPresence/nara.generated.ts";
import { WAKAYAMA_SHELTER_DATASET_PRESENCE } from "./shelterDatasetPresence/wakayama.generated.ts";

export type ShelterDatasetStatus = "available" | "unavailable" | "unknown";

export type ShelterDataCompleteness = {
  /** 指定緊急避難場所（洪水時の避難先候補の元データ）。 */
  emergencyEvacuationSites: ShelterDatasetStatus;
  /** 指定避難所。 */
  designatedShelters: ShelterDatasetStatus;
};

/** 1市町村あたりの、ビルド時に実際にCSVを読み込めたかどうか。 */
export type ShelterDatasetPresence = Record<ShelterDatasetKey, boolean>;

const PRESENCE: Readonly<Record<MunicipalityCode, ShelterDatasetPresence>> = {
  ...SHIGA_SHELTER_DATASET_PRESENCE,
  ...KYOTO_SHELTER_DATASET_PRESENCE,
  ...OSAKA_SHELTER_DATASET_PRESENCE,
  ...HYOGO_SHELTER_DATASET_PRESENCE,
  ...NARA_SHELTER_DATASET_PRESENCE,
  ...WAKAYAMA_SHELTER_DATASET_PRESENCE,
};

const UNKNOWN: ShelterDataCompleteness = { emergencyEvacuationSites: "unknown", designatedShelters: "unknown" };

function datasetStatus(
  municipalityCode: MunicipalityCode,
  presence: ShelterDatasetPresence,
  key: ShelterDatasetKey
): ShelterDatasetStatus {
  if (presence[key]) return "available";
  if (OFFICIALLY_NOT_PROVIDED[municipalityCode]?.includes(key)) return "unavailable";
  return "unknown";
}

/** 市区町村コードから、その市区町村の避難所データ提供状況を返す。 */
export function getShelterDataCompleteness(municipalityCode: MunicipalityCode | undefined): ShelterDataCompleteness {
  if (!municipalityCode) return UNKNOWN;
  const presence = PRESENCE[municipalityCode];
  if (!presence) return UNKNOWN;
  return {
    emergencyEvacuationSites: datasetStatus(municipalityCode, presence, "emergencyEvacuationSites"),
    designatedShelters: datasetStatus(municipalityCode, presence, "designatedShelters"),
  };
}

/**
 * 表示用の要約。
 * - "partial": いずれかのデータ種別が公式に提供されていない
 * - "available": 両方とも公式に提供され、取得できた（「完全」の意味ではない）
 * - "unknown": 上記を判断できない
 */
export function summarizeShelterDataCompleteness(c: ShelterDataCompleteness): "available" | "partial" | "unknown" {
  if (c.emergencyEvacuationSites === "unavailable" || c.designatedShelters === "unavailable") return "partial";
  if (c.emergencyEvacuationSites === "available" && c.designatedShelters === "available") return "available";
  return "unknown";
}
