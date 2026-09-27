// 避難所状況Provider: 外部データ取得の実体をここに閉じ込める（将来の差し替え用の境界）。
// アーキテクチャ: External Data → Provider(このファイル) → Normalizer →
// API/Server → Application → UI。現時点では大阪府への正式な二次利用確認が
// 取れていないため（types.ts参照）、Normalizerも未実装。
//
// 【重要】ここでは常にopenStatus="unknown"を返す「リンク表示フォールバック」を
// 実装する。大阪府への問い合わせが完了し実データ取得を実装できる状況に
// なった際は、この関数の中身だけを差し替えればよく、呼び出し側（将来の
// API Route・避難所詳細UI等）は変更不要になるようにしている。

import type { ShelterStatus, ShelterStatusSource } from "./types.ts";

// 前回の調査（2026-09-28）で実際にアクセスし、内容を確認済みの公式サイトのみを列挙する。
const SHELTER_STATUS_SOURCES: ShelterStatusSource[] = [
  { name: "おおさか防災ネット 避難所検索", url: "https://www.osaka-bousai.net/shelter/index.html" },
];

export async function getShelterStatus(shelterName: string | null = null): Promise<ShelterStatus> {
  return {
    shelterName,
    openStatus: "unknown",
    congestion: undefined,
    fetchedAt: null,
    sources: SHELTER_STATUS_SOURCES,
    note: "避難所の開設・混雑状況の自動取得は未対応です。最新の状況は公式サイトでご確認ください。",
  };
}
