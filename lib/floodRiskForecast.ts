// 要件定義書3: 「大雨が予測されたので通知する」ではなく、
// 「これから降り続けると予測される総雨量が、道路の冠水を引き起こしうる規模か」
// を判断してから通知する、というこのアプリの中心的な設計思想を実現するための
// 予測モジュール。
//
// 【重要な設計判断・データ源】
// 気象庁の高解像度降水ナウキャスト（lib/rainfallForecast.ts）は予測が60分先
// までしかなく、道路が実際に冠水し始めるまでの「これから降り続ける総量」を
// 見るには短すぎる。そのため、このモジュールはOpen-Meteo経由のJMA MSM
// （lib/rainfallForecastOpenMeteo.ts、最大168時間先まで・mm単位の実数値）を
// 使う。これはBacktest研究(要件定義書3)で既に検証済みのデータ源であり、
// 新しいデータ取得ロジックは作らず、既存の関数をそのまま再利用する。
//
// 【重要な限界・正直に明記すること】
// このモジュールが返す「予測総雨量」は、あくまで気象モデルの予測値であり、
// 「その量が実際に対象地点の道路を冠水させるか」を検証済みの物理モデル・
// 実測データに基づいて判定するものではない。要件定義書3 §9・10で確認した
// とおり、洪水ハザードマップ(L2)の想定降雨条件を、河川・流域ごとに予測降雨と
// 正しく対応付ける仕組みは現状存在しない（合成タイルからの逆引き不可）。
// したがって、「総雨量が閾値を超えたら冠水リスクとみなす」という判定は、
// 検証済みの冠水予測モデルではなく、あくまで研究上の代理指標(proxy)である。
// この限界は卒論に明記すること。

import { fetchHourlyPrecipitationForecast, computeAccumulatedRainfall } from "./rainfallForecastOpenMeteo.ts";

export type FloodRiskForecastResult =
  | {
      status: "evaluated";
      /** 予測期間内(windowHours)に降ると予測されている降水量の合計(mm) */
      totalPredictedRainfallMm: number;
      windowHours: number;
      fetchedAt: string;
      source: "open-meteo-jma-msm";
    }
  | { status: "unavailable"; fetchedAt: string; source: "open-meteo-jma-msm" };

/**
 * 指定地点について、今後windowHours時間分の予測降水量の合計を取得する。
 *
 * 【重要】windowHoursは「何時間先までの総雨量を見るか」という研究パラメータ
 * であり、このモジュールでは決め打ちしない(呼び出し側が指定する)。具体的な
 * 採用値は要件定義書3の別途の人間承認により確定する（マジックナンバーとして
 * ここに埋め込まない）。
 */
export async function fetchTotalPredictedRainfall(
  lat: number,
  lng: number,
  windowHours: number
): Promise<FloodRiskForecastResult> {
  // Open-Meteoの予測は日単位(forecast_days)で要求するため、windowHoursを
  // カバーできる日数に切り上げる(最大4日=96時間、fetchHourlyPrecipitationForecast
  // 側の上限に合わせる)。
  const forecastDays = Math.min(4, Math.max(1, Math.ceil(windowHours / 24)));
  const result = await fetchHourlyPrecipitationForecast(lat, lng, forecastDays);

  if (result.status !== "ok") {
    return { status: "unavailable", fetchedAt: result.fetchedAt, source: "open-meteo-jma-msm" };
  }

  // 【重要】欠測(null)が1つでもあれば外挿せずnullを返す既存の方針
  // (computeAccumulatedRainfall)をそのまま踏襲する。
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
