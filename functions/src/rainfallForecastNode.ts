// 要件定義書3「方式A」: lib/rainfallForecast.ts のNode.js版。
//
// 【重要・保守メモ】判定ロジック・データ源・limitationsはすべて
// lib/rainfallForecast.ts と同じ（意図的に複製。理由はhazardPixelClassifierNode.ts
// 冒頭コメントと同じ）。この降雨予測の限界（非公式URL・色→mm/h対応の
// 一次資料未確認等）はNext.jsアプリ側の同名ファイルのコメントを参照。
// 新しい判定ロジックは作らず、Node.js版のタイル取得を使って既存の解釈を
// そのまま再現するだけ。

import { samplePixelFromTileNode } from "./tilePixelNode";
import { matchRainfallColor } from "./rainfallColorLegend";

const NOWCAST_ZOOM = 10;
const TARGET_TIMES_URL = "https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N2.json";
const SOURCE = "jma-nowcast-forecast-n2-unofficial";

type TargetTimeEntry = { basetime: string; validtime: string; elements: string[] };

function buildForecastTileUrlTemplate(basetime: string, validtime: string): string {
  return `https://www.jma.go.jp/bosai/jmatile/data/nowc/${basetime}/none/${validtime}/surf/hrpns/{z}/{x}/{y}.png`;
}

// "20260907184000" -> 比較用の相対ミリ秒値(lib/rainfallForecast.tsと同じ実装)
function parseJmaTimeForDiff(raw: string): number {
  if (raw.length !== 14) return NaN;
  const y = Number(raw.slice(0, 4));
  const mo = Number(raw.slice(4, 6)) - 1;
  const d = Number(raw.slice(6, 8));
  const h = Number(raw.slice(8, 10));
  const mi = Number(raw.slice(10, 12));
  const s = Number(raw.slice(12, 14));
  return Date.UTC(y, mo, d, h, mi, s);
}

// lib/rainfallObservation.ts の formatJmaTimeAsClock と同じ実装(JST "HH:MM"表示用)
function formatJmaTimeAsClock(raw: string): string {
  if (raw.length !== 14) return raw;
  return `${raw.slice(8, 10)}:${raw.slice(10, 12)}`;
}

export type RainfallForecastNodeResult =
  | {
      status: "forecast";
      forecastBaseTime: string;
      forecastValidTime: string;
      leadTimeMinutes: number;
      rank: number | null;
      approxRange: string;
      fetchedAt: string;
      source: typeof SOURCE;
    }
  | {
      status: "unavailable";
      fetchedAt: string;
      source: typeof SOURCE;
    };

export async function fetchRainfallForecastNode(
  lat: number,
  lng: number,
  leadTimeMinutes: number = 30
): Promise<RainfallForecastNodeResult> {
  const fetchedAt = new Date().toISOString();

  let times: TargetTimeEntry[];
  try {
    const res = await fetch(TARGET_TIMES_URL);
    if (!res.ok) return { status: "unavailable", fetchedAt, source: SOURCE };
    times = (await res.json()) as TargetTimeEntry[];
  } catch {
    return { status: "unavailable", fetchedAt, source: SOURCE };
  }
  if (!Array.isArray(times) || times.length === 0) {
    return { status: "unavailable", fetchedAt, source: SOURCE };
  }

  const basetime = times.reduce((a, b) => (a.basetime < b.basetime ? a : b)).basetime;
  const basetimeMs = parseJmaTimeForDiff(basetime);
  const targetMs = basetimeMs + leadTimeMinutes * 60000;

  let best = times[0];
  let bestDiff = Infinity;
  for (const t of times) {
    const diff = Math.abs(parseJmaTimeForDiff(t.validtime) - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = t;
    }
  }

  const urlTemplate = buildForecastTileUrlTemplate(best.basetime, best.validtime);
  const sample = await samplePixelFromTileNode(urlTemplate, lat, lng, NOWCAST_ZOOM);
  const actualLeadMinutes = Math.round((parseJmaTimeForDiff(best.validtime) - basetimeMs) / 60000);
  const forecastBaseTime = formatJmaTimeAsClock(best.basetime);
  const forecastValidTime = formatJmaTimeAsClock(best.validtime);

  if (sample.kind === "error" || sample.kind === "no_tile") {
    return { status: "unavailable", fetchedAt, source: SOURCE };
  }

  if (sample.a === 0) {
    return {
      status: "forecast",
      forecastBaseTime,
      forecastValidTime,
      leadTimeMinutes: actualLeadMinutes,
      rank: 0,
      approxRange: "この地点周辺では降水は予測されていません",
      fetchedAt,
      source: SOURCE,
    };
  }

  const match = matchRainfallColor(sample.r, sample.g, sample.b);
  if (!match.matched) {
    return {
      status: "forecast",
      forecastBaseTime,
      forecastValidTime,
      leadTimeMinutes: actualLeadMinutes,
      rank: null,
      approxRange: "降水を検出しましたが、強さを判別できませんでした",
      fetchedAt,
      source: SOURCE,
    };
  }

  return {
    status: "forecast",
    forecastBaseTime,
    forecastValidTime,
    leadTimeMinutes: actualLeadMinutes,
    rank: match.rank,
    approxRange: match.label,
    fetchedAt,
    source: SOURCE,
  };
}
