// 新機能調査（道路通行止め・道路規制情報）: 型のスケルトンのみ。
//
// 【重要・調査結果 2026-09-28】大阪市内・大阪府内の道路について、「通行
// 止め」「冠水」等の災害関連規制を区別できる自動取得可能な公式データは、
// 今回の調査時点では確認できなかった。
// - JARTIC「交通規制情報」CSV: 構造化データとして取得可能（CC BY互換）だが、
//   月次更新の恒常的な交通規制（標識・標示ベース）のみを対象とし、
//   「冠水」「災害」に対応する規制種別コード自体が存在しない
// - 国土交通省・大阪府・大阪市: いずれも人間向けのリンク集・静的PDF
//   （道路防災情報Webマップの冠水想定箇所リスト等）のみで、API/CSV等の
//   機械可読な自動取得口は確認できなかった
// - NEXCO西日本: HTMLベースの工事規制情報のみ。対象も大阪市中心部（主に
//   阪神高速・一般道）は範囲外
//
// 【重要・安全設計】「情報が取得できない道路＝安全」と絶対に判定しては
// ならないという要件があるため、この型には"safe"/"clear"に相当する値を
// 意図的に含めていない。取得できない場合は常に"unknown"であり、将来
// 経路評価に利用する際も「情報なし」を「安全」と混同できない構造にする。

export type RoadRestrictionSeverity = "closed" | "caution" | "unknown";

export type RoadRestrictionSource = {
  name: string;
  url: string;
};

export type RoadRestriction = {
  /** 対象道路名。特定できない場合はnull（エリア全体の代表情報として扱う）。 */
  roadName: string | null;
  severity: RoadRestrictionSeverity;
  fetchedAt: string | null;
  /** 実際にアクセスして確認済みの公式サイトへのリンク（複数可）。 */
  sources: RoadRestrictionSource[];
  note: string;
};
