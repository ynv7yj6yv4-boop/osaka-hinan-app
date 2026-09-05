// Phase 4A: 現在の降雨実況の取得
//
// 【重要：データの性質について】
// ここで使用している気象庁「高解像度降水ナウキャスト（実況）」のURLは、
// 気象庁が開発者向けに公式に提供しているAPIではありません。
// 気象庁ホームページ（「雨雲の動き」ページ）が内部的に使用しているURLを、
// 第三者が技術的に解析して判明したものです（2026-09-06時点で動作確認済み）。
// 気象庁の都合により、予告なく仕様変更・提供停止される可能性があります。
// 詳細な出典・検証記録は data/README.md を参照してください。
//
// このファイルは「現在の降雨実況」のみを扱います（Phase4Aの方針）。
// 30〜60分先の降雨予測は扱いません（Phase4B以降で別途検討）。
// ハザード判定用のコード（lib/riskAssessment.ts）とは役割を分離し、
// タイル画像から色を読む共通処理（lib/tilePixel.ts）のみを共有しています。

import { samplePixelFromTile } from "./tilePixel";
import { matchRainfallColor } from "./rainfallColorLegend";

// 実況タイルの提供ズームレベル（気象庁の解説記事によれば4〜10）
const NOWCAST_ZOOM = 10;

const TARGET_TIMES_URL = "https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json";

type TargetTimeEntry = { basetime: string; validtime: string; elements: string[] };

function buildTileUrlTemplate(basetime: string): string {
  return `https://www.jma.go.jp/bosai/jmatile/data/nowc/${basetime}/none/${basetime}/surf/hrpns/{z}/{x}/{y}.png`;
}

// "20260905195000" (YYYYMMDDHHMMSS, JST) -> "19:50"
function formatJmaTimeAsClock(raw: string): string {
  if (raw.length !== 14) return raw;
  return `${raw.slice(8, 10)}:${raw.slice(10, 12)}`;
}

export type RainfallObservationResult =
  | {
      status: "observed";
      /** レーダーが表している対象時刻（JST, "HH:MM"形式。データの鮮度確認用） */
      dataTimeLabel: string;
      /** このアプリが実際に取得を行った時刻（ISO文字列） */
      fetchedAt: string;
      /** 0=降水なし、1〜8=段階（値が大きいほど強い）。色を認識できなかった場合はnull */
      rank: number | null;
      /** 表示用の目安ラベル（例:「10〜20mm/h程度」）。推定値であることに注意 */
      approxRange: string;
    }
  | {
      status: "fetch_error";
      fetchedAt: string;
    };

export async function fetchRainfallObservation(
  lat: number,
  lng: number
): Promise<RainfallObservationResult> {
  const fetchedAt = new Date().toISOString();

  let times: TargetTimeEntry[];
  try {
    const res = await fetch(TARGET_TIMES_URL);
    if (!res.ok) return { status: "fetch_error", fetchedAt };
    times = await res.json();
  } catch {
    return { status: "fetch_error", fetchedAt };
  }
  if (!Array.isArray(times) || times.length === 0) {
    return { status: "fetch_error", fetchedAt };
  }

  // 配列の先頭が最新時刻（気象庁側の並び順を前提とせず、念のため最大値を採用）
  const latest = times.reduce((a, b) => (a.basetime > b.basetime ? a : b));
  const urlTemplate = buildTileUrlTemplate(latest.basetime);

  const sample = await samplePixelFromTile(urlTemplate, lat, lng, NOWCAST_ZOOM);
  const dataTimeLabel = formatJmaTimeAsClock(latest.validtime);

  if (sample.kind === "error" || sample.kind === "no_tile") {
    return { status: "fetch_error", fetchedAt };
  }

  if (sample.a === 0) {
    return {
      status: "observed",
      dataTimeLabel,
      fetchedAt,
      rank: 0,
      approxRange: "この地点周辺では降水は検出されていません",
    };
  }

  const match = matchRainfallColor(sample.r, sample.g, sample.b);
  if (!match.matched) {
    return {
      status: "observed",
      dataTimeLabel,
      fetchedAt,
      rank: null,
      approxRange: "降水を検出しましたが、強さを判別できませんでした",
    };
  }

  return {
    status: "observed",
    dataTimeLabel,
    fetchedAt,
    rank: match.rank,
    approxRange: match.label,
  };
}
