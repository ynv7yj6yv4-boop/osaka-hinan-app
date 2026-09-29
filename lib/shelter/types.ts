// Phase 3: 避難所データの地域拡張（大阪市→大阪府全域）にあたり、
// 今後 京都府・兵庫県 等へも拡張できるよう定義した共通型。
//
// 【既存型との関係】既存のUI層（ShelterLayer.tsx・EvacuationPanel.tsx・
// ShelterDetailContent.tsx）が使う`ShelterFeature`/`FloodShelterCandidate`
// （lib/floodShelterCandidates.ts）は、フィールド名（lat/lng・type等）を
// 変更していない。この`Shelter`型は、各都道府県のProvider（lib/shelter/
// *Provider.ts）が公式データを正規化する際の「出力形式」であり、
// lib/floodShelterCandidates.ts側でUI向けの既存形式に変換して渡す
// （UI層の変更を最小にするため）。
//
// 【洪水対応(flood)の3状態について・重要】
// 国土地理院「指定緊急避難場所」データは、災害種別ごとの列（洪水・地震等）に
// 「該当は「1」、非該当は無記入」という明確なルールを持つ（公式データ定義）。
// そのため、指定緊急避難場所レコードでは「空欄＝その災害種別に非該当」という
// 明示的な行政判断であり、flood: false として扱う（「unknown」にしない）。
// 一方、「指定避難所」（もう一方のデータ種別）には災害種別の列そのものが
// 存在しない（構造的にデータが無い）。この場合はflood: "unknown"とする
// （「対応していない」と断定できる情報が無いため）。
// この使い分けは、既存のhazardPixelClassifier.ts等における
// 「outside（確認できた区域外）」と「unknown（判定材料が無い）」の
// 区別の考え方と同じ設計思想に基づく。

import type { PrefectureCode, MunicipalityCode } from "../region/types.ts";

/**
 * 避難所・避難場所の種別。
 * - "designated_emergency_evacuation_site": 指定緊急避難場所（災害種別ごとに指定）
 * - "designated_shelter": 指定避難所（一定期間滞在するための施設。災害種別の区分なし）
 * - "both": 両方に指定されている同一施設（今回のPhaseでは生成しない。将来、
 *   指定緊急避難場所・指定避難所の名寄せ処理を追加した場合に使う予約値）
 * - "unknown": 種別を判別できない場合（今回のPhaseでは生成しない）
 */
export type ShelterType =
  | "designated_emergency_evacuation_site"
  | "designated_shelter"
  | "both"
  | "unknown";

export type SupportedDisasters = {
  /** 洪水（指定緊急避難場所の「洪水」列）に対応した避難場所として指定されているか。
   *  true/false は指定緊急避難場所データの明示的な行政判断、
   *  "unknown" はその判断材料（列）自体が存在しないデータ種別であることを示す。 */
  flood: boolean | "unknown";
};

export type Shelter = {
  /** 全国共通避難所・避難場所ID（内閣府ルールに基づく。国内で一意）。 */
  id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;

  prefectureCode: PrefectureCode;
  municipalityCode: MunicipalityCode;
  prefectureName?: string;
  municipalityName?: string;

  shelterType: ShelterType;
  supportedDisasters: SupportedDisasters;

  /** 指定緊急避難場所データの災害種別列で「1」だった全キー（表示用の生データ。
   *  例: ["flood","earthquake","tsunami"]）。既存UI（対応災害バッジ等）との
   *  互換性のために保持する。洪水対応の判定・候補絞り込みには
   *  supportedDisasters.flood を使うこと（このフィールドは使わない）。
   *  指定避難所（designated_shelter）には災害種別の列自体が無いため常に[]。 */
  hazards: string[];

  /** データ出典（表示・監査用）。 */
  source: string;

  // 避難所詳細情報の拡充: 地域のオープンデータ等で補完できた場合のみ値が入る
  // （今回のPhaseでは大阪市のみ。他市町村はすべてnull＝推測で埋めない）。
  telephone?: string | null;
  availableHours?: string | null;
  ward?: string | null;
  category?: string | null;
};
