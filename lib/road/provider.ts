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

// 【重要・2026-09-30】以前は下記2件のリンクを掲載していたが、実機（iPhone）で
// 開いた際に内容が正しく表示できないことが確認されたため削除した。
// HTTPステータス自体は200を返す（技術的な意味でのリンク切れではない）ため、
// 前回のOsaka市ホームページ404のケースとは異なり、代替URLを推測して補うことも
// しない（存在しない情報を作らない方針）。sources=[]の間は
// ExternalDisasterInfoCard側が空配列を検出しリンク一覧自体を表示しない。
const ROAD_INFO_SOURCES: RoadRestrictionSource[] = [];

export async function getRoadRestriction(roadName: string | null = null): Promise<RoadRestriction> {
  return {
    roadName,
    severity: "unknown",
    fetchedAt: null,
    sources: ROAD_INFO_SOURCES,
    note: "道路の通行止め・冠水等の規制情報の自動取得は未対応です。最新の状況は公式サイトでご確認ください。",
  };
}
