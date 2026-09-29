// Phase 6 PART B: 府県境を越えた避難先候補検索の「どの府県のShelterProviderを
// 検索対象にするか」を、地域判定結果（RegionCheckResult）から1か所で決める。
//
// 【設計方針】
// - 近畿6府県すべてのJSONを無条件に取得しない。検索対象は
//   「現在の府県」＋「現在地からCROSS_PREFECTURE_SEARCH_DISTANCE_METERS以内に
//   ある、実際に隣接する府県（lib/region/prefectureAdjacency.ts）」だけ。
//   距離判定自体はサーバー側の地域判定（lib/region/regionLookup.tsの
//   nearbyPrefectureCodes）が境界データを使って済ませており、ここでは
//   その結果を読むだけ（クライアントへ境界データを送らない）。
// - 府県境付近で地域判定がunknown（reason:"boundary_ambiguity"）の場合、
//   unknownそのものは維持したまま（現在の府県を断定しない）、
//   candidatePrefectureCodesの府県すべてを検索対象にする。
//   それ以外のunknown・error・outsideでは検索しない（従来どおり）。
// - MapView.tsx・EvacuationPanel.tsx等のUI層に「if 大阪府 / if 奈良県」の
//   ような分岐を書かないため、この判定はこのファイルに閉じ込める。

import { isShelterSupportedPrefecture } from "../region/capability.ts";
import type { PrefectureCode, RegionCheckResult } from "../region/types.ts";

export type ShelterSearchScope = {
  /** 検索対象の府県コード（重複なし）。primaryPrefectureCodeがある場合は先頭。 */
  prefectureCodes: PrefectureCode[];
  /** 現在地の府県（地域判定で確定できた場合のみ）。boundary_ambiguityではnull。 */
  primaryPrefectureCode: PrefectureCode | null;
  /**
   * - "current_prefecture_only": 府県境から離れており、現在の府県のみ
   * - "near_prefecture_boundary": 府県境付近のため、隣接府県も含める
   * - "boundary_ambiguity": 府県境のごく近くで現在の府県を確定できないため、
   *   候補となる府県すべてを含める
   */
  reason: "current_prefecture_only" | "near_prefecture_boundary" | "boundary_ambiguity";
};

/**
 * 地域判定結果から、避難先候補の検索対象府県を決める。
 * 検索できない場合（近畿外・判定エラー・境界のあいまいさ以外の理由のunknown等）はnull。
 */
export function getShelterSearchScope(regionCheck: RegionCheckResult | null): ShelterSearchScope | null {
  if (!regionCheck) return null;

  if (regionCheck.status === "supported") {
    const primary = regionCheck.region.prefectureCode;
    if (!isShelterSupportedPrefecture(primary)) return null;
    const neighbors = regionCheck.region.nearbyPrefectureCodes.filter(
      (code) => code !== primary && isShelterSupportedPrefecture(code)
    );
    return {
      prefectureCodes: [primary, ...new Set(neighbors)],
      primaryPrefectureCode: primary,
      reason: neighbors.length > 0 ? "near_prefecture_boundary" : "current_prefecture_only",
    };
  }

  if (regionCheck.status === "unknown" && regionCheck.reason === "boundary_ambiguity") {
    const codes = [...new Set(regionCheck.candidatePrefectureCodes ?? [])].filter(isShelterSupportedPrefecture);
    if (codes.length === 0) return null;
    return { prefectureCodes: codes, primaryPrefectureCode: null, reason: "boundary_ambiguity" };
  }

  return null;
}
