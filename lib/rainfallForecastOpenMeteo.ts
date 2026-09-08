// 試作3 通知判定ロジック設計: Open-Meteo経由のJMA MSM（メソスケールモデル）
// 降雨予測の取得。
//
// 【この情報源を選んだ理由】
// 気象庁「高解像度降水ナウキャスト予測」(lib/rainfallForecast.ts, N2系列)は
// 60分先までしか予測がなく、しかもPNG画像の解析が必要でNode.js
// (Firebase Functions)環境では追加実装なしに動かせない(既存の制約)。
// 一方、Open-Meteoが提供するJMA MSM(気象庁 メソスケールモデル)の値は、
// - 元データは気象庁が発表する数値予報モデル(MSM)そのもの
// - Open-Meteoは非商用・研究用途では無料・APIキー不要(CC BY 4.0、要出典表記)
// - レスポンスがJSONであり、画像デコードが不要 → Firebase Functions
//   (Node.js)からもそのまま呼び出せる
// という利点があり、3時間〜24時間先の予測累積雨量を扱うのに適している。
//
// 【重要な限界】
// - 元データはOpen-Meteoという第三者サービスが気象庁の数値予報モデル出力を
//   再配信しているものであり、気象庁が自ら提供する開発者向け公式APIでは
//   ない（気象庁公式のデータではあるが、配信経路は第三者）。
// - 時間解像度は1時間（前1時間の合計値）。30分・60分単位の短時間予測が
//   欲しい場合はlib/rainfallForecast.ts（ナウキャスト予測）の方が適する。
//   両者を混同・代替使用しない。
// - 空間解像度は0.05度（約5km格子）。地点(緯度経度)を指定すると、
//   最も近い格子点の値が返るとみられる（Open-Meteo内部の補間方式の
//   詳細は未確認）。河川流域平均ではなく、あくまで「その格子点の予測値」
//   である点に注意（PART6参照）。
// - 予測期間は最大4日間(96時間)、3時間ごとに更新。

const OPEN_METEO_JMA_URL = "https://api.open-meteo.com/v1/jma";
const SOURCE = "open-meteo-jma-msm" as const;

export type HourlyPrecipitationPoint = {
  /** ISO文字列。この1時間の終端時刻（Open-Meteoは「前1時間の合計」として値を返すため） */
  time: string;
  /** mm（前1時間の降水量合計）。APIが値を返さなかった場合はnull（0mmと混同しない）。 */
  precipitationMm: number | null;
};

export type OpenMeteoForecastResult =
  | {
      status: "ok";
      fetchedAt: string;
      /** 取得できた時間単位の降水量の並び（最大96時間分） */
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

// 試作3 通知判定ロジックの実験実装 PART16: 過去に実際に発表された予報の
// 時系列を取得する(Backtest用)。
//
// 【重要な限界】Open-Meteo公式ドキュメントによれば、このAPIは
// 「各モデル更新の最初の数時間を継ぎ合わせた連続時系列」であり、
// 3時間おきに発表される個別のモデルrun(forecast run)そのものを
// 単体で取得するものではない。そのため、このデータを使った
// forecast run間継続性の検証は「近似」であり、真に独立したrun単位の
// アーカイブを使った検証ではないことをBacktestスクリプト側で明記する。
const OPEN_METEO_HISTORICAL_URL = "https://historical-forecast-api.open-meteo.com/v1/forecast";

export type HistoricalForecastResult =
  | { status: "ok"; fetchedAt: string; hourly: HourlyPrecipitationPoint[]; source: typeof SOURCE }
  | { status: "unavailable"; fetchedAt: string; source: typeof SOURCE };

export async function fetchHistoricalHourlyPrecipitation(
  lat: number,
  lng: number,
  startDate: string, // "YYYY-MM-DD"
  endDate: string
): Promise<HistoricalForecastResult> {
  const fetchedAt = new Date().toISOString();
  const url =
    `${OPEN_METEO_HISTORICAL_URL}?latitude=${lat}&longitude=${lng}` +
    `&hourly=precipitation&models=jma_msm&start_date=${startDate}&end_date=${endDate}&timezone=Asia%2FTokyo`;

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
  /** 積算対象の開始・終了時刻 */
  windowStart: string;
  windowEnd: string;
  accumulationWindowMinutes: number;
  /** 実際に積算に使えた時間単位データの件数（欠損があれば window/60 より少ない） */
  hoursUsed: number;
  rainfallMm: number;
  spatialResolution: "jma-msm-0.05deg";
  source: typeof SOURCE;
};

/**
 * 取得済みの時間単位予測から、指定した時間幅(分単位、60の倍数)の積算雨量を計算する。
 *
 * 【重要】PART4の指示どおり、提供されていない時間帯を外挿・推測しない。
 * 例えば取得できたのが24時間分のみなら、48時間の積算は計算できず、
 * hoursUsedが不足している旨を呼び出し側が判断できるようにする
 * （このアプリでは「取得できた時間数 < 要求時間数」ならnullを返す）。
 */
export function computeAccumulatedRainfall(
  hourly: HourlyPrecipitationPoint[],
  accumulationWindowMinutes: number
): AccumulatedForecastRainfall | null {
  if (accumulationWindowMinutes % 60 !== 0 || accumulationWindowMinutes <= 0) return null;
  const hoursNeeded = accumulationWindowMinutes / 60;
  if (hourly.length < hoursNeeded) return null; // 外挿しない。データ不足ならnull

  const windowPoints = hourly.slice(0, hoursNeeded);
  // 欠測(null)が1つでもあれば、0mmとして扱わずnullを返す(外挿・穴埋めしない)
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
