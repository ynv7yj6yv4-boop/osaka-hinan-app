// 【重要・保守メモ】このファイルはNext.jsアプリ側の lib/floodRiskForecast.ts
// と内容を同期させること（コピー管理の理由はnotificationDecisionConfig.ts
// 冒頭コメント参照）。判定ロジック・限界の説明はlib/側と同じなので、
// 詳細な設計意図のコメントはlib/floodRiskForecast.tsを参照。

import { fetchHourlyPrecipitationForecast, computeAccumulatedRainfall } from "./rainfallForecastOpenMeteo";

export type FloodRiskForecastResult =
  | {
      status: "evaluated";
      totalPredictedRainfallMm: number;
      windowHours: number;
      fetchedAt: string;
      source: "open-meteo-jma-msm";
    }
  | { status: "unavailable"; fetchedAt: string; source: "open-meteo-jma-msm" };

export async function fetchTotalPredictedRainfall(
  lat: number,
  lng: number,
  windowHours: number
): Promise<FloodRiskForecastResult> {
  const forecastDays = Math.min(4, Math.max(1, Math.ceil(windowHours / 24)));
  const result = await fetchHourlyPrecipitationForecast(lat, lng, forecastDays);

  if (result.status !== "ok") {
    return { status: "unavailable", fetchedAt: result.fetchedAt, source: "open-meteo-jma-msm" };
  }

  const accumulated = computeAccumulatedRainfall(result.hourly, windowHours * 60);
  if (!accumulated) {
    return { status: "unavailable", fetchedAt: result.fetchedAt, source: "open-meteo-jma-msm" };
  }

  return {
    status: "evaluated",
    totalPredictedRainfallMm: accumulated.rainfallMm,
    windowHours,
    fetchedAt: result.fetchedAt,
    source: "open-meteo-jma-msm",
  };
}
