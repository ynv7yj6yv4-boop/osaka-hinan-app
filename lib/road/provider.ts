// 道路規制Provider: 外部データ取得の実体をここに閉じ込める（将来の差し替え用の境界）。
// アーキテクチャ: External Data → Provider(このファイル) → Normalizer →
// API/Server → Application → UI。現時点ではExternal Dataそのものが無い
// （types.ts参照）ため、Normalizerも未実装。
//
// 【重要】ここでは常にseverity="unknown"を返す「リンク表示フォールバック」を
// 実装する。実データ取得を実装できる状況になった際は、この関数の中身だけを
// 差し替えればよく、呼び出し側（将来のAPI Route・避難ルート評価等）は
// 変更不要になるようにしている。

import type { RoadRestriction, RoadRestrictionSource } from "./types.ts";

// 前回の調査（2026-09-28）で実際にアクセスし、内容を確認済みの公式サイトのみを列挙する。
const ROAD_INFO_SOURCES: RoadRestrictionSource[] = [
  { name: "近畿地方整備局 大阪国道事務所 道路交通情報", url: "https://www.kkr.mlit.go.jp/osaka/koutu_info/" },
  { name: "JARTIC 交通規制情報（オープンデータ）", url: "https://www.jartic.or.jp/service/opendata/" },
];

export async function getRoadRestriction(roadName: string | null = null): Promise<RoadRestriction> {
  return {
    roadName,
    severity: "unknown",
    fetchedAt: null,
    sources: ROAD_INFO_SOURCES,
    note: "道路の通行止め・冠水等の規制情報の自動取得は未対応です。最新の状況は公式サイトでご確認ください。",
  };
}
