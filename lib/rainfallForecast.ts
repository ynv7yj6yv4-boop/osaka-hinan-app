// 試作3 PART 3（要件定義書2 PART 12・13）: 降雨予測の取得。
//
// 【重要：Phase4Aの実況(lib/rainfallObservation.ts)とは完全に別モジュール】
// 混在させない方針(要件定義書2 PART F-2)のとおり、型・関数名・ファイルを
// 分離している。実況側のコードは一切変更していない(formatJmaTimeAsClockの
// export追加のみ、既存の挙動は変更なし)。
//
// 【この機能の限界（必ず読むこと）】
// 1. 気象庁が開発者向けに公式提供しているAPIではない。実況と同じ仕組みを
//    ベースにした非公式URL。予告なく変更・停止される可能性がある
//    (lib/rainfallObservation.tsの注記と同じ限界を引き継ぐ)。
// 2. 実際にAPIへ問い合わせて確認した結果、targetTimes_N2.jsonには
//    「実況の基準時刻(basetime)を固定したまま、5分刻みで60分先までの
//    validtime」が含まれていることを確認した(2026-09-07時点)。
//    これは気象庁の解説にある「高解像度降水ナウキャスト(予測)」に対応する
//    と考えられるが、この対応関係も状況証拠であり一次資料による確認ではない。
// 3. 色→mm/hの対応は実況と同じ表(lib/rainfallColorLegend.ts)を流用している。
//    実況側と同様、この対応表自体が状況証拠の組み合わせであり、
//    気象庁の一次資料による確認ではない。
// 4. あくまで「予測」であり、実際の降雨と異なる場合がある。
//
// これらの理由により、この予測値を人間の確認なしに通知条件の閾値へ
// 直接組み込むことは禁止する(lib/notificationDecisionConfig.ts参照)。

import { samplePixelFromTile } from "./tilePixel.ts";
import { matchRainfallColor } from "./rainfallColorLegend.ts";
import { formatJmaTimeAsClock } from "./rainfallObservation.ts";

const NOWCAST_ZOOM = 10;
const TARGET_TIMES_URL = "https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N2.json";
const SOURCE = "jma-nowcast-forecast-n2-unofficial";

type TargetTimeEntry = { basetime: string; validtime: string; elements: string[] };

function buildForecastTileUrlTemplate(basetime: string, validtime: string): string {
  return `https://www.jma.go.jp/bosai/jmatile/data/nowc/${basetime}/none/${validtime}/surf/hrpns/{z}/{x}/{y}.png`;
}

// "20260907184000" -> 比較用の相対ミリ秒値（タイムゾーンの扱いは問わない。
// 同じデータセット内の時刻同士の差分計算にのみ使うため）
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

export type RainfallForecastResult =
  | {
      status: "forecast";
      /** 予測の基準時刻(実況の最新時刻に相当, JST "HH:MM") */
      forecastBaseTime: string;
      /** この予測が対象とする時刻(JST "HH:MM") */
      forecastValidTime: string;
      /** 基準時刻から何分先の予測か(要求値に最も近いものを採用した実際の値) */
      leadTimeMinutes: number;
      /** lib/rainfallColorLegend.ts の rank(1〜8)。0=降水予測なし。判別不能ならnull。 */
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

/**
 * 指定地点・指定リード タイムに最も近い予測タイルから、降雨予測を取得する。
 * @param leadTimeMinutes 何分先の予測が欲しいか（既定30分）。実際に採用される
 *   のは、利用可能な予測時刻の中で最も近いもの(5分刻み、最大60分先程度)。
 */
export async function fetchRainfallForecast(
  lat: number,
  lng: number,
  leadTimeMinutes: number = 30
): Promise<RainfallForecastResult> {
  const fetchedAt = new Date().toISOString();

  let times: TargetTimeEntry[];
  try {
    const res = await fetch(TARGET_TIMES_URL);
    if (!res.ok) return { status: "unavailable", fetchedAt, source: SOURCE };
    times = await res.json();
  } catch {
    return { status: "unavailable", fetchedAt, source: SOURCE };
  }
  if (!Array.isArray(times) || times.length === 0) {
    return { status: "unavailable", fetchedAt, source: SOURCE };
  }

  // N2系列はbasetimeが全件共通（実況の最新時刻）で、validtimeが5分刻みに
  // 将来へ進む想定。念のため決め打ちにせず、最小のbasetimeを基準とする。
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
  const sample = await samplePixelFromTile(urlTemplate, lat, lng, NOWCAST_ZOOM);
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
