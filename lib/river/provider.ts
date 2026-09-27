// 河川状況Provider: 外部データ取得の実体をここに閉じ込める（将来の差し替え用の境界）。
// アーキテクチャ: External Data → Provider(このファイル) → Normalizer →
// API/Server → Application → UI。現時点ではExternal Dataそのものが無い
// （types.ts参照）ため、Normalizerも未実装。
//
// 【重要】ここでは常にlevel="unknown"を返す「リンク表示フォールバック」を
// 実装する。実データ取得を実装できる状況になった際は、この関数の中身だけを
// 差し替えればよく、呼び出し側（将来のAPI Route等）は変更不要になるように
// している。

import type { RiverStatus, RiverStatusSource } from "./types.ts";

// 前回の調査（2026-09-28）で実際にアクセスし、内容を確認済みの公式サイトのみを列挙する。
const RIVER_INFO_SOURCES: RiverStatusSource[] = [
  { name: "国土交通省 川の防災情報", url: "https://www.river.go.jp/" },
  { name: "大阪府河川防災情報ポータル", url: "https://www.osaka-kasen-portal.net/" },
];

export async function getRiverStatus(riverName: string | null = null): Promise<RiverStatus> {
  return {
    riverName,
    level: "unknown",
    fetchedAt: null,
    sources: RIVER_INFO_SOURCES,
    note: "河川の水位・監視カメラ情報の自動取得は未対応です。最新の状況は公式サイトでご確認ください。",
  };
}
