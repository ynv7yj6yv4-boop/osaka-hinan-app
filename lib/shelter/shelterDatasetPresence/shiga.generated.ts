// このファイルは scripts/build-shelters.mjs が自動生成する（手で編集しないこと）。
// 滋賀県の市町村ごとに、国土地理院の公式CSVをビルド時に読み込めたかどうか。
// 解釈（available/unavailable/unknown）は lib/shelter/dataCompleteness.ts を参照。

import type { ShelterDatasetPresence } from "../dataCompleteness.ts";

export const SHIGA_SHELTER_DATASET_PRESENCE: Record<string, ShelterDatasetPresence> = {
  "25201": { emergencyEvacuationSites: true, designatedShelters: true },
  "25202": { emergencyEvacuationSites: true, designatedShelters: true },
  "25203": { emergencyEvacuationSites: true, designatedShelters: true },
  "25204": { emergencyEvacuationSites: false, designatedShelters: true },
  "25206": { emergencyEvacuationSites: true, designatedShelters: true },
  "25207": { emergencyEvacuationSites: true, designatedShelters: true },
  "25208": { emergencyEvacuationSites: true, designatedShelters: true },
  "25209": { emergencyEvacuationSites: true, designatedShelters: true },
  "25210": { emergencyEvacuationSites: true, designatedShelters: true },
  "25211": { emergencyEvacuationSites: true, designatedShelters: true },
  "25212": { emergencyEvacuationSites: true, designatedShelters: true },
  "25213": { emergencyEvacuationSites: true, designatedShelters: true },
  "25214": { emergencyEvacuationSites: true, designatedShelters: true },
  "25383": { emergencyEvacuationSites: true, designatedShelters: true },
  "25384": { emergencyEvacuationSites: true, designatedShelters: true },
  "25425": { emergencyEvacuationSites: true, designatedShelters: true },
  "25441": { emergencyEvacuationSites: true, designatedShelters: true },
  "25442": { emergencyEvacuationSites: true, designatedShelters: false },
  "25443": { emergencyEvacuationSites: true, designatedShelters: true },
};
