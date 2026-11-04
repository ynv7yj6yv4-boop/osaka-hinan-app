// 現在地の災害リスク（RiskLevel）へ「予想雨量」を加味するためのモジュール。
//
// 【背景】これまでRiskLevelは静的なハザード情報（洪水浸水想定区域・想定浸水深）だけで
// 決まっていたため、浸水想定区域内では晴天時でも常に「高リスク」と表示され、
// マイ避難スイッチも常にONになってしまう問題があった。そこで、今後の予想雨量を
// 組み合わせ、「浸水想定区域内で、まとまった雨が予想されている」場合に高リスクとする。
//
// 【データ源】lib/rainfallForecastOpenMeteo.ts（Open-Meteo経由のJMA MSM、1時間ごとのmm値）を
// そのまま再利用する。新しい外部データ源は追加していない。
//
// 【重要・未確定の暫定値】FORECAST_RAINFALL_RISK_CONFIGの数値は研究上の暫定値であり、
// 「この雨量で実際にこの地点が浸水する」ことを検証したものではない。
// - 1時間雨量: 気象庁「雨の強さと降り方」の区分（20mm/h以上「強い雨」、30mm/h以上「激しい雨」）
// - 24時間雨量: notificationDecisionConfigの候補値（100mm）と同じ丸めた目安。50mmはその半分
// 通知判定（lib/notificationDecision.ts）とは独立した設定として持つ（相互に参照しない）。
//
// 【安全側の方針】予想雨量を取得できない場合は、レベルを引き下げず従来の静的判定のままにする。

import type { DepthRank } from "./hazardColorLegend.ts";
import { fetchHourlyPrecipitationForecast, type HourlyPrecipitationPoint } from "./rainfallForecastOpenMeteo.ts";

export const FORECAST_RAINFALL_RISK_CONFIG = {
  version: "forecast-rainfall-v1-provisional",
  /** 今後何時間分の予想雨量を見るか */
  windowHours: 24,
  /** 「まとまった雨」とみなす24時間予想雨量(mm) */
  moderateTotalMm: 50,
  /** 「大雨」とみなす24時間予想雨量(mm) */
  heavyTotalMm: 100,
  /** 「まとまった雨」とみなす1時間予想雨量(mm/h)。気象庁の「強い雨」 */
  moderateHourlyMm: 20,
  /** 「大雨」とみなす1時間予想雨量(mm/h)。気象庁の「激しい雨」 */
  heavyHourlyMm: 30,
} as const;

export type ForecastRainfallConfig = {
  version: string;
  windowHours: number;
  moderateTotalMm: number;
  heavyTotalMm: number;
  moderateHourlyMm: number;
  heavyHourlyMm: number;
};

export type ForecastRainfallCategory = "low" | "moderate" | "heavy";

export type ForecastRainfallSummary =
  | {
      status: "evaluated";
      /** 予想期間内の合計予想雨量(mm) */
      totalMm: number;
      /** 予想期間内の最大1時間雨量(mm/h) */
      maxHourlyMm: number;
      windowHours: number;
      fetchedAt: string;
      source: "open-meteo-jma-msm";
    }
  | { status: "unavailable"; fetchedAt: string; source: "open-meteo-jma-msm" };

// Open-Meteoはtimezone=Asia/Tokyo指定時、"2026-11-04T13:00"のようなオフセット無しの
// 日本時間で返す。各値は「その時刻までの前1時間の合計」。
function parseJstHour(time: string): number {
  return new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(time) ? time : `${time}:00+09:00`).getTime();
}

/**
 * 1時間ごとの予想雨量から、「今から」windowHours時間分の合計・最大1時間雨量を求める純粋関数。
 * Open-Meteoの応答は当日0時からの値を含むため、既に終わった時間帯は除く
 * （現在進行中の1時間は含める）。欠測(null)があれば0mmとみなさずnullを返す。
 */
export function summarizeForecastRainfall(
  hourly: HourlyPrecipitationPoint[],
  now: Date,
  windowHours: number
): { totalMm: number; maxHourlyMm: number } | null {
  const nowMs = now.getTime();
  const future = hourly.filter((p) => {
    const t = parseJstHour(p.time);
    return Number.isFinite(t) && t > nowMs;
  });
  if (future.length < windowHours) return null; // 外挿しない
  const windowPoints = future.slice(0, windowHours);
  if (windowPoints.some((p) => p.precipitationMm === null)) return null;
  const values = windowPoints.map((p) => p.precipitationMm as number);
  const totalMm = Math.round(values.reduce((a, b) => a + b, 0) * 10) / 10;
  return { totalMm, maxHourlyMm: Math.max(...values) };
}

export function categorizeForecastRainfall(
  summary: { totalMm: number; maxHourlyMm: number },
  config: ForecastRainfallConfig = FORECAST_RAINFALL_RISK_CONFIG
): ForecastRainfallCategory {
  if (summary.totalMm >= config.heavyTotalMm || summary.maxHourlyMm >= config.heavyHourlyMm) return "heavy";
  if (summary.totalMm >= config.moderateTotalMm || summary.maxHourlyMm >= config.moderateHourlyMm) return "moderate";
  return "low";
}

/**
 * 静的な想定浸水深ランクと予想雨量の区分から、RiskLevel（safe/caution/prepare）を決める。
 *
 * |                 | 少ない(low) | まとまった雨(moderate) | 大雨(heavy) |
 * |-----------------|-------------|------------------------|-------------|
 * | 区域外(rank 0)  | safe        | safe                   | caution     |
 * | 0.5m未満(rank 1)| caution     | caution                | prepare     |
 * | 0.5m以上(rank≥2)| caution     | prepare                | prepare     |
 *
 * - 浸水想定区域内でも、雨が予想されていなければ「高リスク」にはしない
 *   （ただし区域内であることは「注意」として残し、低リスクとは表示しない）。
 * - 「最高リスク(evacuate)」は、公式の警戒レベル等と連動していない現状では使わない
 *   （既存方針の維持）。
 */
export function combineStaticAndForecast(
  staticRank: DepthRank | number,
  category: ForecastRainfallCategory
): "safe" | "caution" | "prepare" {
  if (staticRank <= 0) return category === "heavy" ? "caution" : "safe";
  if (staticRank === 1) return category === "heavy" ? "prepare" : "caution";
  return category === "low" ? "caution" : "prepare";
}

/** 予想雨量を取得してまとめる（I/O）。失敗時はunavailableを返し、例外は投げない。 */
export async function fetchForecastRainfallSummary(
  lat: number,
  lng: number,
  now: Date = new Date(),
  config: ForecastRainfallConfig = FORECAST_RAINFALL_RISK_CONFIG
): Promise<ForecastRainfallSummary> {
  // 当日0時からの値が返るため、今からwindowHours時間分を確実に含むよう1日多く取得する。
  const forecastDays = Math.min(4, Math.ceil(config.windowHours / 24) + 1);
  const result = await fetchHourlyPrecipitationForecast(lat, lng, forecastDays);
  if (result.status !== "ok") return { status: "unavailable", fetchedAt: result.fetchedAt, source: "open-meteo-jma-msm" };
  const summary = summarizeForecastRainfall(result.hourly, now, config.windowHours);
  if (!summary) return { status: "unavailable", fetchedAt: result.fetchedAt, source: "open-meteo-jma-msm" };
  return {
    status: "evaluated",
    ...summary,
    windowHours: config.windowHours,
    fetchedAt: result.fetchedAt,
    source: "open-meteo-jma-msm",
  };
}
