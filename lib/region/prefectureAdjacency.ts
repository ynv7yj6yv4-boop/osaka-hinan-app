// Phase 6 PART B: 都道府県の隣接関係（近畿2府4県のみ）。
//
// 【重要・出典】目視推測ではなく、実際の行政区域データ（国土数値情報N03、
// data/region-boundaries/kinki-municipalities.geojson）から、都道府県ごとの
// 市区町村ポリゴンを統合（@turf/union）し、50mバッファ後に他県ポリゴンと
// 交差判定（@turf/intersect）することで機械的に検証した（Phase 6実施時）。
//
// 【発見】直感的な地図イメージだけでは見落としやすい隣接関係として、
// 京都府南山城村と奈良県（奈良市北部・山添村）が実際に隣接していることを
// 確認した。これにより京都⇔奈良も隣接関係に含めている。
//
// この一覧は、府県境検索（lib/shelter/crossPrefectureSearch.ts）が
// 「どの隣接府県のShelterProviderを検索候補にできるか」を判定する際の
// 唯一の情報源。MapView.tsx等のUI層に個別の条件分岐は書かない。

import type { PrefectureCode } from "./types.ts";

export const ADJACENT_PREFECTURES: Record<PrefectureCode, PrefectureCode[]> = {
  "25": ["26"], // 滋賀県 → 京都府
  "26": ["25", "27", "28", "29"], // 京都府 → 滋賀・大阪・兵庫・奈良
  "27": ["26", "28", "29", "30"], // 大阪府 → 京都・兵庫・奈良・和歌山
  "28": ["26", "27"], // 兵庫県 → 京都・大阪
  "29": ["26", "27", "30"], // 奈良県 → 京都・大阪・和歌山
  "30": ["27", "29"], // 和歌山県 → 大阪・奈良
};
