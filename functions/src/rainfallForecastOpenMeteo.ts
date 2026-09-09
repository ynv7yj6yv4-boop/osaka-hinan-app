// 【重要・保守メモ】このファイルは Next.js アプリ側の
// lib/rainfallForecastOpenMeteo.ts と内容を同期させること（コピー管理の理由は
// notificationDecisionConfig.ts冒頭コメント参照）。このファイルはCanvas等の
// ブラウザAPIに依存しない(fetch+JSON解析のみ)ため、Node.js版として新規実装
// する必要はなく、そのまま複製している。
//
// 試作3 通知判定ロジック設計: Open-Meteo経由のJMA MSM（メソスケールモデル）
// 降雨予測の取得。
//
// 【この情報源を選んだ理由】
// 気象庁「高解像度降水ナウキャスト予測」(rainfallForecastNode.ts, N2系列)は
// 60分先までしか予測がなく、道路の冠水を引き起こしうる総雨量を見るには
// 短すぎる。一方、Open-MeteoのJMA MSMはJSONのため画像デコードが不要で、
// Firebase Functions(Node.js)からもそのまま呼び出せ、3時間〜168時間先の
// 予測累積雨量を扱うのに適している(要件定義書3の中心的な設計思想
// 「予測総雨量に基づく冠水リスク早期警戒」で採用)。
//
// 【重要な限界】
// - 元データはOpen-Meteoという第三者サービスが気象庁の数値予報モデル出力を
//   再配信しているものであり、気象庁が自ら提供する開発者向け公式APIでは
//   ない。
// - 時間解像度は1時間（前1時間の合計値）。
// - 空間解像度は0.05度（約5km格子）。地点(緯度経度)を指定すると、
//   最も近い格子点の値が返るとみられる。河川流域平均ではない。
// - 予測期間は最大4日間(96時間)、3時間ごとに更新。

const OPEN_METEO_JMA_URL = "https://api.open-meteo.com/v1/jma";
const SOURCE = "open-meteo-jma-msm" as const;

export type HourlyPrecipitationPoint = {
  time: string;
  precipitationMm: number | null;
};

export type OpenMeteoForecastResult =
  | {
      status: "ok";
      fetchedAt: string;
      hourly: HourlyPrecipitationPoint[];
      source: typeof SOURCE;
    }
  | { status: "unavailable"; fetchedAt: string; source: typeof SOURCE };

/**
 * 指定地点の時間単位降水量予測(mm/hour)を取得する。
 * forecastDays: 何日先まで取得するか（最大4）。
 */
export async function fetchHourlyPrecipitationForecast(
  lat: number,
  lng: number,
  forecastDays: number = 2
): Promise<OpenMeteoForecastResult> {
  const fetchedAt = new Date().toISOString();
  const url = `${OPEN_METEO_JMA_URL}?latitude=${lat}&longitude=${lng}&hourly=precipitation&forecast_days=${Math.min(
    4,
    Math.max(1, forecastDays)
  )}&timezone=Asia%2FTokyo`;

  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    return { status: "unavailable", fetchedAt, source: SOURCE };
  }
  if (!res.ok) return { status: "unavailable", fetchedAt, source: SOURCE };

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { status: "unavailable", fetchedAt, source: SOURCE };
  }

  const hourly = (data as { hourly?: { time?: string[]; precipitation?: number[] } })?.hourly;
  if (!hourly || !Array.isArray(hourly.time) || !Array.isArray(hourly.precipitation)) {
    return { status: "unavailable", fetchedAt, source: SOURCE };
  }

  const points: HourlyPrecipitationPoint[] = hourly.time.map((t, i) => ({
    time: t,
    precipitationMm: typeof hourly.precipitation![i] === "number" ? hourly.precipitation![i] : null,
  }));

  return { status: "ok", fetchedAt, hourly: points, source: SOURCE };
}

export type AccumulatedForecastRainfall = {
  forecastBaseTime: string;
  windowStart: string;
  windowEnd: string;
  accumulationWindowMinutes: number;
  hoursUsed: number;
  rainfallMm: number;
  spatialResolution: "jma-msm-0.05deg";
  source: typeof SOURCE;
};

/**
 * 取得済みの時間単位予測から、指定した時間幅(分単位、60の倍数)の積算雨量を計算する。
 * 欠測(null)が1つでもあれば0mmとして扱わずnullを返す(外挿・穴埋めしない)。
 */
export function computeAccumulatedRainfall(
  hourly: HourlyPrecipitationPoint[],
  accumulationWindowMinutes: number
): AccumulatedForecastRainfall | null {
  if (accumulationWindowMinutes % 60 !== 0 || accumulationWindowMinutes <= 0) return null;
  const hoursNeeded = accumulationWindowMinutes / 60;
  if (hourly.length < hoursNeeded) return null; // 外挿しない。データ不足ならnull

  const windowPoints = hourly.slice(0, hoursNeeded);
  if (windowPoints.some((p) => p.precipitationMm === null)) return null;
  const rainfallMm = windowPoints.reduce((sum, p) => sum + (p.precipitationMm as number), 0);

  return {
    forecastBaseTime: hourly[0]?.time ?? new Date().toISOString(),
    windowStart: windowPoints[0].time,
    windowEnd: windowPoints[windowPoints.length - 1].time,
    accumulationWindowMinutes,
    hoursUsed: windowPoints.length,
    rainfallMm,
    spatialResolution: "jma-msm-0.05deg",
    source: SOURCE,
  };
}
