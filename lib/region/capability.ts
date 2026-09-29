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

// Phase 3で大阪府全域（43市町村）、Phase 4で京都府全域（26市町村）・
// 兵庫県全域（41市町村）、Phase 5で滋賀県全域（19市町村）・奈良県全域
// （39市町村）・和歌山県全域（30市町村）の避難所データを実装済み
// （lib/shelter/provider.ts・各prefectureProvider.ts・
// public/data/{prefecture}-prefecture-shelters.json参照。いずれも全市町村で
// 公式データの個別レコード存在を確認済み）。これにより近畿2府4県すべてが
// "supported"となった。三重県等、近畿2府4県の外は引き続き"unsupported"
// （対象外の県のデータを誤って流用しない）。
//
// 【重要・"supported"の意味について】ここでの"supported"は「このアプリが
// その都道府県の避難所データをProvider経由で提供できる（＝取得を試みてよい）」
// ことのみを表し、「国土地理院の公式データが当該都道府県内で完全に
// 提供されている」ことを保証するものではない。実例: 滋賀県（25）は全体として
// "supported"だが、県内の近江八幡市(25204)は指定緊急避難場所データが、
// 甲良町(25442)は指定避難所データが、それぞれGSI公式サイト側の既知の
// 欠落により提供されていない（ダウンロードページの「データ整備状況の
// 特筆事項」欄に明記された公式の状態であり、取得処理の不具合ではない。
// 両市町村とも該当データ自体が0件になるわけではない。詳細は
// data/README.md「Phase 5」参照）。都道府県単位のCapabilityStatusは、
// この市区町村単位の粒度の違いまでは表現しない設計上の割り切りであり、
// 「supported＝完全」という誤読を避けるため、ここに明記する。
//
// 【将来の拡張方針・今回は未実装】市区町村単位のデータ完全性
// （例: "complete"/"partial"/"unknown"）を表現する必要が生じた場合は、
// RegionCapability.shelterの型を`CapabilityStatus`から
// `{ status: CapabilityStatus; completeness?: "complete" | "partial" | "unknown" }`
// のような構造へ拡張するか、あるいはlib/shelter/types.tsのShelter型に
// 市区町村単位のデータ完全性フラグを追加する形で対応できる。
// CapabilityStatus自体はflood/inlandFlood/rainfall/elevationとも共有する
// 型のため、この拡張は影響範囲をshelterフィールドのみに限定できるよう
// 設計するのが望ましい（他機能の判定ロジックに影響を与えないため）。
const SHELTER_SUPPORTED_PREFECTURE_CODES: readonly string[] = ["25", "26", "27", "28", "29", "30"];

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
 * - shelter（避難所データ）: Phase 3〜5で近畿2府4県（滋賀・京都・大阪・
 *   兵庫・奈良・和歌山）すべてに対応（各府県すべての市町村分の国土地理院
 *   データを取得・確認済み。scripts/build-shelters.mjs参照）。近畿2府4県の
 *   外（三重県等）は、市区町村が判定できていてもいなくても"unsupported"
 *   （対象外の県データの誤流用を避けるため、既定は常に非対応）。
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
