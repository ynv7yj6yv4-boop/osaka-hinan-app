// 地域判定基盤（Phase 2）: 「地域として近畿2府4県内である」ことと、
// 「その地域で各機能が実際に使えること」を分離して管理する層。
//
// 【重要・安全設計】ここでのstatusは"supported"/"unsupported"/"unknown"の
// いずれかであり、「データが無い＝安全」という扱いは一切しない。
// "unsupported"・"unknown"はいずれも「この機能の結果を安全側の判定材料と
// して使ってはならない」ことを意味する（既存のriskAssessment.ts等が
// hazard未検出をunknownとして扱う設計と同じ思想）。

import type { Region } from "./types.ts";
import { getInlandFloodAvailability } from "./inlandFloodAvailability.ts";

export type CapabilityStatus = "supported" | "unsupported" | "unknown";

// 【重要・2026-09-30の方針・訂正版】内水氾濫は「データが確認できない
// 地域」でのみ評価を省略する。データが存在する可能性がある地域では、
// 他の項目（flood・shelter・rainfall・elevation）と同様にinlandFloodも
// 通常のCapabilityStatusとして扱い、UI表示・対応可否判定に使用してよい
// （例: MapView.tsxの「一部機能は準備中」の判定にもinlandFloodを含める）。
export type RegionCapability = {
  flood: CapabilityStatus;
  inlandFlood: CapabilityStatus;
  shelter: CapabilityStatus;
  rainfall: CapabilityStatus;
  elevation: CapabilityStatus;
};

// Phase 3で大阪府全域（43市町村）の避難所データを実装済み（lib/shelter/
// provider.ts・osakaProvider.ts・public/data/osaka-prefecture-shelters.json
// 参照。実際に43市町村すべてで公式データの個別レコード存在を確認済み）。
// 大阪府（27）以外の府県は、この段階ではまだ避難所データを持たないため
// "unsupported"（他県のデータを誤って流用しない）。
const SHELTER_SUPPORTED_PREFECTURE_CODES: readonly string[] = ["27"];

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
 * - inlandFlood（内水浸水想定区域）: 都道府県ごとに提供状況が大きく異なる
 *   ため、getInlandFloodAvailability()に判断を委譲する（詳細は同ファイル）。
 * - shelter（避難所データ）: Phase 3で大阪府（27）全域に対応（43市町村分の
 *   国土地理院データを取得・確認済み。scripts/build-shelters.mjs参照）。
 *   大阪府以外の府県は、市区町村が判定できていてもいなくても
 *   "unsupported"（他県データの誤流用を避けるため、既定は常に非対応）。
 */
export function getRegionCapability(region: Region): RegionCapability {
  return {
    flood: "supported",
    inlandFlood: getInlandFloodAvailability(region.prefectureCode),
    shelter: SHELTER_SUPPORTED_PREFECTURE_CODES.includes(region.prefectureCode) ? "supported" : "unsupported",
    rainfall: "supported",
    elevation: "supported",
  };
}
