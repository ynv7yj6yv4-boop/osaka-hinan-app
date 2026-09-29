// 地域判定基盤（Phase 2）: 「地域として近畿2府4県内である」ことと、
// 「その地域で各機能が実際に使えること」を分離して管理する層。
//
// 【重要・安全設計】ここでのstatusは"supported"/"unsupported"/"unknown"の
// いずれかであり、「データが無い＝安全」という扱いは一切しない。
// "unsupported"・"unknown"はいずれも「この機能の結果を安全側の判定材料と
// して使ってはならない」ことを意味する（既存のriskAssessment.ts等が
// hazard未検出をunknownとして扱う設計と同じ思想）。

import type { PrefectureCode, Region } from "./types.ts";
import { getInlandFloodAvailability } from "./inlandFloodAvailability.ts";

export type CapabilityStatus = "supported" | "unsupported" | "unknown";

export type RegionCapability = {
  flood: CapabilityStatus;
  inlandFlood: CapabilityStatus;
  shelter: CapabilityStatus;
  rainfall: CapabilityStatus;
  elevation: CapabilityStatus;
};

/**
 * 【Phase 6（2026-09-30）の方針】内水氾濫は、アプリ全体で現行の対象外とする。
 * 実測の結果、近畿で内水氾濫タイルが実際に存在するのはオープンデータ化を
 * 許諾した8市町村のみで、大阪市・京都市・神戸市等の主要都市には存在しない
 * ことが分かった（lib/region/inlandFloodAvailability.ts参照）。そのため、
 * 危険度判定・ルート評価のいずれでも内水氾濫を評価しない（タイルへの
 * リクエスト自体を行わない）。
 * 将来、市区町村単位で再導入する場合はこの値と
 * getRegionCapability()のinlandFlood算出だけを変更すればよい
 * （lib/riskAssessment.ts・lib/routeSegmentRisk.tsの内水氾濫評価コード自体は、
 * タイルURLを渡された場合のみ動く形で残してある）。
 */
export const INLAND_FLOOD_EVALUATION_ENABLED = false;

// Phase 3で大阪府全域（43市町村）、Phase 4で京都府全域（26市町村）・
// 兵庫県全域（41市町村）、Phase 5で滋賀県全域（19市町村）・奈良県全域
// （39市町村）・和歌山県全域（30市町村）の避難所データを実装済み
// （lib/shelter/provider.ts・各prefectureProvider.ts・
// public/data/{prefecture}-prefecture-shelters.json参照）。これにより近畿2府4県
// すべてが"supported"となった。三重県等、近畿2府4県の外は引き続き"unsupported"
// （対象外の県のデータを誤って流用しない）。
//
// 【重要・"supported"の意味について】ここでの"supported"は「このアプリが
// その都道府県の避難所データをProvider経由で提供できる（＝取得を試みてよい）」
// ことのみを表し、「国土地理院の公式データが当該都道府県内で完全に
// 提供されている」ことを保証するものではない。実例: 滋賀県（25）は全体として
// "supported"だが、県内の近江八幡市(25204)は指定緊急避難場所データが、
// 甲良町(25442)は指定避難所データが、それぞれGSI公式サイト側で提供されていない。
// 市区町村単位のデータ提供状況は、Phase 6でこのRegionCapabilityとは別の
// ShelterDataCompleteness（lib/shelter/dataCompleteness.ts）として表現する
// （CapabilityStatusはflood/rainfall等とも共有する型のため、ここは変更しない）。
const SHELTER_SUPPORTED_PREFECTURE_CODES: readonly string[] = ["25", "26", "27", "28", "29", "30"];

/** 指定した都道府県の避難所データをProvider経由で取得してよいか。
 *  （府県境検索（lib/shelter/crossPrefectureSearch.ts）でも、隣接府県を
 *  検索対象に含めてよいかの判定に同じ基準を使う。） */
export function isShelterSupportedPrefecture(prefectureCode: PrefectureCode): boolean {
  return SHELTER_SUPPORTED_PREFECTURE_CODES.includes(prefectureCode);
}

/**
 * 指定した地域で、各機能が現時点で「使ってよい」状態かどうかを返す。
 *
 * 【2026-09-29時点の調査結果に基づく判断根拠】
 * - flood（洪水浸水想定区域L2）: 都道府県コードを含まない全国統合タイル。
 *   近畿2府4県の県庁所在地で実データ取得を確認済みのため、近畿2府4県は
 *   一律 "supported"。ただし都道府県管理河川分は「都道府県の許諾次第」
 *   という制約が公式に明記されており、完全性までは保証しない。
 * - rainfall（気象庁高解像度降水ナウキャスト）: 全国共通・都道府県コード
 *   非依存であることが気象庁公式解説ページで確認できたため、一律 "supported"。
 * - elevation（国土地理院DEM標高タイル）: 全国整備のdem5a/5b/10bの
 *   3段フォールバック構造を持ち、近畿2府4県の都市部・山間部の
 *   スポットチェックで実データ取得を確認済みのため、一律 "supported"。
 * - inlandFlood（内水浸水想定区域）: Phase 6でアプリ全体の対象外とした
 *   （INLAND_FLOOD_EVALUATION_ENABLED参照）ため、一律 "unsupported"。
 *   これは地域ごとの「準備中」ではなくアプリの対象範囲の判断のため、
 *   UIの「一部機能は準備中」表示の判定材料には含めない（MapView.tsx参照）。
 * - shelter（避難所データ）: Phase 3〜5で近畿2府4県すべてに対応。近畿2府4県の
 *   外（三重県等）は"unsupported"（対象外の県データの誤流用を避けるため）。
 */
export function getRegionCapability(region: Region): RegionCapability {
  return {
    flood: "supported",
    inlandFlood: INLAND_FLOOD_EVALUATION_ENABLED ? getInlandFloodAvailability(region.prefectureCode) : "unsupported",
    shelter: isShelterSupportedPrefecture(region.prefectureCode) ? "supported" : "unsupported",
    rainfall: "supported",
    elevation: "supported",
  };
}
