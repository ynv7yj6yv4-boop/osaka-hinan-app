// 試作3 通知判定ロジック設計 PART1・3・5・6: ハザードマップの想定降雨条件と、
// 予測降雨を比較するための型・関数（枠組みのみ）。
//
// 【最重要・必ず読むこと】
// 洪水浸水想定区域図(L2, 想定最大規模)の想定降雨は、国土交通省の技術基準
// 「浸水想定(洪水、内水)の作成等のための想定最大外力の設定手法」(2015年7月)
// に基づき、全国を降雨特性の似た15地域に区分した上で、河川の流域面積・
// 降雨継続時間(河川の洪水到達時間等を参考に設定)ごとに定められている。
// 大阪府は154の府管理河川それぞれについて個別に浸水想定区域図を公表しており
// （大阪市管理河川・国管理河川は別途）、想定降雨条件は河川ごとに異なりうる。
//
// 現在アプリが使用しているハザードタイル
// (disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data)は、
// これら多数の河川の個別の浸水想定区域図を1枚のタイルに合成したものであり、
// タイルの色(浸水深ランク)だけからは「その地点がどの河川の、どの想定降雨
// 条件に基づく区域なのか」を機械的に逆引きできない。
//
// 【したがって】現時点では、登録地点の座標から実際のRainfallAssumption
// （想定総雨量・継続時間等）を特定する手段がなく、下記の比較関数は
// 常に"not_comparable"を返す。将来、河川名・想定降雨条件を紐づけた
// GISデータ等を別途入手できた場合にのみ、実際の比較が可能になる。
//
// 【重要】想定降雨量は「浸水想定区域を計算するための外力条件」であり、
// 「その雨量に到達した瞬間に浸水する閾値」ではない。この型・関数を将来
// 使う場合も、rainfallProgressRatioを「洪水発生確率」「危険度○%」等の
// 断定的な数値として扱わないこと（あくまで参考指標）。

export type RainfallAssumption = {
  /** 想定総雨量(mm) */
  totalRainfallMm: number;
  /** 想定降雨継続時間(時間) */
  durationHours: number;
  /** 地点雨量か流域平均雨量か */
  spatialDefinition: "point" | "basin-average";
  /** 対象河川・水系名 */
  riverOrBasin: string;
  source: string;
};

export type ForecastRainfallWindow = {
  forecastBaseTime: string;
  forecastValidTime: string;
  leadTimeMinutes: number;
  rainfallMm: number;
  accumulationWindowMinutes: number;
  spatialResolution: string;
  source: string;
};

export type RainfallComparisonResult =
  | {
      status: "comparable";
      /** forecastRainfall.rainfallMm / assumption.totalRainfallMm。
       *  【重要】これは「想定降雨に対して予測雨量がどの程度の規模か」を示す
       *  参考指標に過ぎない。洪水発生確率・安全度・危険度(%)ではない。 */
      rainfallProgressRatio: number;
      assumption: RainfallAssumption;
      forecast: ForecastRainfallWindow;
    }
  | {
      status: "not_comparable";
      reason:
        | "assumption_unavailable" // 想定降雨条件そのものを特定できない(現状すべてこれに該当)
        | "duration_mismatch" // 継続時間の単位・長さが一致しない
        | "spatial_definition_mismatch"; // 地点雨量と流域平均雨量など、定義が異なる
    };

/**
 * 想定降雨条件と予測降雨を比較する（純粋関数）。
 * 時間スケール・空間定義が一致しない場合は無理に数値化せず"not_comparable"を返す。
 */
export function compareRainfallToAssumption(
  assumption: RainfallAssumption | null,
  forecast: ForecastRainfallWindow
): RainfallComparisonResult {
  if (!assumption) {
    return { status: "not_comparable", reason: "assumption_unavailable" };
  }

  const assumptionMinutes = assumption.durationHours * 60;
  if (assumptionMinutes !== forecast.accumulationWindowMinutes) {
    return { status: "not_comparable", reason: "duration_mismatch" };
  }

  // 予測(地点予報)は基本的に「地点」の値であり、想定降雨が「流域平均」の
  // 場合は単純比較できない(PART6)。地点同士の比較のみ許可する。
  if (assumption.spatialDefinition !== "point") {
    return { status: "not_comparable", reason: "spatial_definition_mismatch" };
  }

  return {
    status: "comparable",
    rainfallProgressRatio: forecast.rainfallMm / assumption.totalRainfallMm,
    assumption,
    forecast,
  };
}
