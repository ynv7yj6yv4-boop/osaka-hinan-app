// このファイルは scripts/build-shelters.mjs が自動生成する（手で編集しないこと）。
// 京都府の市町村ごとに、国土地理院の公式CSVをビルド時に読み込めたかどうか。
// 解釈（available/unavailable/unknown）は lib/shelter/dataCompleteness.ts を参照。

import type { ShelterDatasetPresence } from "../dataCompleteness.ts";

export const KYOTO_SHELTER_DATASET_PRESENCE: Record<string, ShelterDatasetPresence> = {
  "26100": { emergencyEvacuationSites: true, designatedShelters: true },
  "26201": { emergencyEvacuationSites: true, designatedShelters: true },
  "26202": { emergencyEvacuationSites: true, designatedShelters: true },
  "26203": { emergencyEvacuationSites: true, designatedShelters: true },
  "26204": { emergencyEvacuationSites: true, designatedShelters: true },
  "26205": { emergencyEvacuationSites: true, designatedShelters: true },
  "26206": { emergencyEvacuationSites: true, designatedShelters: true },
  "26207": { emergencyEvacuationSites: true, designatedShelters: true },
  "26208": { emergencyEvacuationSites: true, designatedShelters: true },
  "26209": { emergencyEvacuationSites: true, designatedShelters: true },
  "26210": { emergencyEvacuationSites: true, designatedShelters: true },
  "26211": { emergencyEvacuationSites: true, designatedShelters: true },
  "26212": { emergencyEvacuationSites: true, designatedShelters: true },
  "26213": { emergencyEvacuationSites: true, designatedShelters: true },
  "26214": { emergencyEvacuationSites: true, designatedShelters: true },
  "26303": { emergencyEvacuationSites: true, designatedShelters: true },
  "26322": { emergencyEvacuationSites: true, designatedShelters: true },
  "26343": { emergencyEvacuationSites: true, designatedShelters: true },
  "26344": { emergencyEvacuationSites: true, designatedShelters: true },
  "26364": { emergencyEvacuationSites: true, designatedShelters: true },
  "26365": { emergencyEvacuationSites: true, designatedShelters: true },
  "26366": { emergencyEvacuationSites: true, designatedShelters: true },
  "26367": { emergencyEvacuationSites: true, designatedShelters: true },
  "26407": { emergencyEvacuationSites: true, designatedShelters: true },
  "26463": { emergencyEvacuationSites: true, designatedShelters: true },
  "26465": { emergencyEvacuationSites: true, designatedShelters: true },
};
