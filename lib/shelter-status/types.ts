// 新機能調査（避難所の開設・混雑状況）: 型のスケルトンのみ。
//
// 【重要・調査結果 2026-09-28】おおさか防災ネットの避難所検索ページ
// （https://www.osaka-bousai.net/shelter/index.html）が内部で参照している
// GeoJSON（openstatcd＝開設状況・refugecongestion＝混雑度フィールドを含む）
// の実在を確認したが、以下の理由から今回は自動取得を実装しない。
// - 正式に文書化されたAPIではなく、公式サイトの内部実装（フロントエンドが
//   読むファイル）への依存になり、将来の変更リスクが高い
// - 免責事項ページに、二次利用（複製・加工等）の際は事前に大阪府政策企画部
//   危機管理室へ問い合わせるよう明記されている（書面での許諾が前提）
// - 平常時は全件（大阪市571件含む）が「未開設・混雑度空欄」であり、実用上
//   のリアルタイム性がほぼない（2026-09-28時点で実データを確認済み）
//
// 【重要・安全設計】「混雑度」は公開データに実在するフィールドではあるが、
// 上記の理由から現時点では取得しない。値が無いことと「空いている」ことを
// 混同しないよう、congestionは省略可能（undefined）とし、UI側は
// 「congestionがundefined→表示しない」という扱いを想定する（推測で埋めない）。

export type ShelterOpenStatus = "open" | "closed" | "not_yet_open" | "unknown";

/** 混雑状況。値が無い場合（congestion未設定）は「不明」を意味し、「空いている」等を推測しない。 */
export type ShelterCongestion = "available" | "crowded" | "full";

export type ShelterStatusSource = {
  name: string;
  url: string;
};

export type ShelterStatus = {
  /** 対象避難所名。既存のFloodShelterCandidate等と名称で紐付けることを想定。 */
  shelterName: string;
  openStatus: ShelterOpenStatus;
  congestion?: ShelterCongestion;
  fetchedAt: string | null;
  source: ShelterStatusSource;
  note: string;
};
