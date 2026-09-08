// 試作3 通知判定ロジックの実験実装: 案C（staticFloodHazard + 予測降雨 +
// 状態変化 + 継続性）の内部状態機構・4方式比較・実験パラメータ化。
//
// 【最重要・繰り返し明記】
// これは「ハザードマップ想定降雨と完全に連携した最終方式」ではなく、
// 通知判定方式を過去データで比較するための**実験基盤**である
// (data/README.md「通知判定の位置づけ」参照)。
// notificationDecisionConfig.enabled は引き続きfalseであり、この実験実装
// 自体が実際のPush送信につながることはない（本番判定モジュール
// lib/notificationDecision.tsとは別系統として実装している）。
//
// ここで使う閾値(NotificationExperimentConfig)はすべて「実験パラメータ」
// であり、最終的な採用値ではない。コード中にマジックナンバーとして
// 閾値を書かない。

// ============================================================
// 予報スナップショット（PART1・2・11）
// ============================================================

/**
 * 1回のforecast取得結果から、実験に必要な値だけを抜き出したもの。
 * 【重要】欠測は必ずnullで表現し、0mmとして扱わない(PART2)。
 * 【重要】30分値はJMA MSM(1時間解像度)からは作らない(PART1)。
 *   1時間・3時間・6時間の3つの時間窓のみを主対象とする。
 */
export type ForecastRunSnapshot = {
  /** このデータの取得時刻(ISO) */
  fetchedAt: string;
  /** 次の1〜6時間分の時間雨量(mm)。index 0 = 直近1時間。欠測はnull。 */
  hourlyRainfallMm: (number | null)[];
  /**
   * 【run再現性監査で修正・重要】以前は「Open-Meteoの標準レスポンスに
   * run時刻の明示フィールドが無い」という理由でcontentHashのみをrun識別に
   * 使っていた。その後、Open-Meteo公式ドキュメントで、標準のforecast API
   * (/v1/jma)は「run識別を保証しない」一方、Single Runs API
   * (single-runs-api.open-meteo.com)は&run=パラメータでrun初期時刻
   * (runInitialisationTime)を明示的に指定・識別できることを確認した
   * (実際にAPIを呼び出し、同一run再取得時の再現性・3時間後の別runとの
   * 区別・168時間分のforecast horizon保持を確認済み)。
   * そのためrunInitialisationTimeを追加し、Single Runs API使用時は
   * これを優先的なrun識別子として使う（標準のforecast APIから取得した
   * 場合はnullのままとし、その場合のみcontentHashにフォールバックする。
   * PART4: contentHashは「内容が変化したかの確認用」であり、run IDの
   * 代替としては使わない）。
   */
  runInitialisationTime: string | null;
  /** 予報内容から計算した簡易ハッシュ（内容の同一性確認の補助情報） */
  contentHash: string;
};

/**
 * run識別に使うキーを解決する。runInitialisationTimeが分かればそれを
 * 優先し、無い場合（標準forecast API使用時）のみcontentHashにフォールバック
 * する（PART4の方針）。
 */
export function resolveRunKey(forecast: ForecastRunSnapshot): string {
  return forecast.runInitialisationTime ?? forecast.contentHash;
}

/** hourlyRainfallMmから、先頭N時間の積算値を計算する。欠測が1つでもあればnull（外挿しない）。 */
export function accumulateRainfall(hourly: (number | null)[], hours: number): number | null {
  const slice = hourly.slice(0, hours);
  if (slice.length < hours) return null;
  if (slice.some((v) => v === null)) return null;
  return (slice as number[]).reduce((sum: number, v: number) => sum + v, 0);
}

/** hourlyRainfallMmの先頭N時間のうち、最大の時間雨量を求める。欠測のみの場合はnull。 */
export function maxHourlyRainfall(hourly: (number | null)[], hours: number): number | null {
  const slice = hourly.slice(0, hours).filter((v): v is number => v !== null);
  if (slice.length === 0) return null;
  return Math.max(...slice);
}

/**
 * PART2の必須値をまとめて計算する（表示・ログ記録用のヘルパー）。
 */
export function summarizeForecastWindow(hourly: (number | null)[]) {
  return {
    next1hRainfallMm: hourly[0] ?? null,
    next3hAccumulatedRainfallMm: accumulateRainfall(hourly, 3),
    next6hAccumulatedRainfallMm: accumulateRainfall(hourly, 6),
    maxHourlyRainfallNext3h: maxHourlyRainfall(hourly, 3),
    maxHourlyRainfallNext6h: maxHourlyRainfall(hourly, 6),
  };
}

/**
 * 予測内容から簡易ハッシュを作る（PART11のmodelRunTime代替）。
 * 暗号学的な強度は不要（同じ内容かどうかの識別のみが目的）なので、
 * 依存追加を避け、簡単な文字列ハッシュを自前実装する。
 */
export function hashForecastContent(hourly: (number | null)[]): string {
  const input = hourly.map((v) => (v === null ? "n" : v.toFixed(2))).join(",");
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return `h${(hash >>> 0).toString(16)}`;
}

// ============================================================
// 実験パラメータ（PART7）
// ============================================================

export type NotificationExperimentConfig = {
  /** 実験IDと版数。感度分析で複数のconfigを比較する際の識別に使う。 */
  configId: string;
  hourlyRainfallThresholdMm: number;
  accumulated3hThresholdMm: number;
  accumulated6hThresholdMm: number;
  /** forecast内継続性(PART5-A): 連続何時間、hourlyRainfallThresholdMm以上が
   *  必要か */
  requiredConsecutiveForecastHours: number;
  /** forecast run間継続性(PART5-B): 連続何回のforecast runで降雨条件を
   *  満たす必要があるか */
  requiredConsecutiveRuns: number;
};

// ============================================================
// 降雨条件の判定（絶対値のみ。ハザード・状態遷移・継続性はここでは見ない）
// ============================================================

export type RainConditionCheck = "met" | "not_met" | "insufficient_data";

/**
 * 1h/3h/6hのいずれかの閾値を満たせば"met"とする(OR条件)。
 * 3つとも計算できない(欠測)場合のみ"insufficient_data"。
 */
export function checkRainCondition(
  forecast: ForecastRunSnapshot,
  config: NotificationExperimentConfig
): RainConditionCheck {
  const next1h = forecast.hourlyRainfallMm[0] ?? null;
  const next3h = accumulateRainfall(forecast.hourlyRainfallMm, 3);
  const next6h = accumulateRainfall(forecast.hourlyRainfallMm, 6);

  if (next1h === null && next3h === null && next6h === null) return "insufficient_data";

  const met =
    (next1h !== null && next1h >= config.hourlyRainfallThresholdMm) ||
    (next3h !== null && next3h >= config.accumulated3hThresholdMm) ||
    (next6h !== null && next6h >= config.accumulated6hThresholdMm);

  return met ? "met" : "not_met";
}

/** forecast内継続性(PART5-A): 同一runの中で、閾値以上の時間雨量が連続何時間続くか */
export function checkForecastInternalPersistence(
  forecast: ForecastRunSnapshot,
  config: NotificationExperimentConfig
): boolean {
  let consecutive = 0;
  let maxConsecutive = 0;
  for (const v of forecast.hourlyRainfallMm) {
    if (v !== null && v >= config.hourlyRainfallThresholdMm) {
      consecutive++;
      maxConsecutive = Math.max(maxConsecutive, consecutive);
    } else {
      consecutive = 0;
    }
  }
  return maxConsecutive >= config.requiredConsecutiveForecastHours;
}

// ============================================================
// 内部状態機構（PART3・4）
// ============================================================
//
// 【重要】この3状態はアプリ内部の実験用コードであり、気象庁の「注意報」
// 「警戒レベル」等の公的名称を流用していない。ユーザーにはこの内部状態を
// 直接表示しない。

export type NotificationInternalState = "normal" | "candidate_unconfirmed" | "candidate_confirmed";

export type PersistenceTracking = {
  /** forecast run間継続性(PART5-B): 直近何回連続で降雨条件が"met"だったか */
  consecutiveRunsMatched: number;
  /**
   * 直前に評価したrunの識別キー(重複evaluation検出用、PART4修正)。
   * resolveRunKey()の結果を保持する
   * (runInitialisationTimeがあればそれ、無ければcontentHash)。
   */
  lastEvaluatedRunKey: string | null;
};

export type NotificationPointState = {
  internalState: NotificationInternalState;
  persistence: PersistenceTracking;
};

export function initialNotificationPointState(): NotificationPointState {
  return {
    internalState: "normal",
    persistence: { consecutiveRunsMatched: 0, lastEvaluatedRunKey: null },
  };
}

/**
 * PART6: 今回取得したforecastが前回評価と同一runかどうかを判定する。
 * 同一であれば、Scheduled Functions側で評価自体をskipする設計に使える
 * (無駄な再評価を避ける)。runInitialisationTimeがあればそれで判定し、
 * 無い場合のみcontentHashにフォールバックする(resolveRunKey参照)。
 */
export function hasForecastChanged(forecast: ForecastRunSnapshot, prev: NotificationPointState): boolean {
  return resolveRunKey(forecast) !== prev.persistence.lastEvaluatedRunKey;
}

// ============================================================
// 4方式の比較（PART6）
// ============================================================

export type MethodId =
  | "rain_only" // Method1: 比較対照。本番候補ではない
  | "hazard_and_rain" // Method2
  | "hazard_rain_state_change" // Method3
  | "hazard_rain_state_change_persistence"; // Method4

export const ALL_METHOD_IDS: readonly MethodId[] = [
  "rain_only",
  "hazard_and_rain",
  "hazard_rain_state_change",
  "hazard_rain_state_change_persistence",
];

export type StaticFloodHazardGate = "hazard" | "outside" | "unknown";

export type MethodEvaluationResult = {
  method: MethodId;
  rainCondition: RainConditionCheck;
  forecastInternalPersistenceMet: boolean;
  forecastRunPersistenceMet: boolean;
  previousInternalState: NotificationInternalState;
  newInternalState: NotificationInternalState;
  isCandidate: boolean;
  reason: string;
  updatedState: NotificationPointState;
};

/**
 * 指定した方式(method)で、1回分のforecastを評価する（純粋関数）。
 *
 * 【設計メモ】
 * - Method1(rain_only)は比較対照用のため、内部状態機構を使わず、
 *   条件を満たすたびに"候補"として数える(状態変化・継続性を無視)。
 *   本番の通知候補として扱わないことをresult.reasonに明記する。
 * - Method2は、hazard区域内 かつ 降雨条件成立なら常に候補
 *   (状態変化・継続性は見ない。Method3以降との比較対照)。
 * - Method3は、hazard区域内 かつ 降雨条件成立という条件が
 *   「新たに」成立した場合(normal→candidate_unconfirmedへの遷移)のみ候補。
 *   継続性は見ない。
 * - Method4は、Method3の条件に加え、forecast内継続性
 *   またはforecast run間継続性のいずれかが満たされ、
 *   candidate_confirmedへ遷移した場合のみ候補。
 */
export function evaluateMethod(
  method: MethodId,
  input: {
    staticFloodHazardStatus: StaticFloodHazardGate;
    forecast: ForecastRunSnapshot;
    previousState: NotificationPointState;
    config: NotificationExperimentConfig;
  }
): MethodEvaluationResult {
  const { staticFloodHazardStatus, forecast, previousState, config } = input;
  const rainCondition = checkRainCondition(forecast, config);
  const forecastInternalPersistenceMet = checkForecastInternalPersistence(forecast, config);

  // --- Method1: Rain Only（比較対照。ハザード・状態・継続性を一切見ない） ---
  if (method === "rain_only") {
    return {
      method,
      rainCondition,
      forecastInternalPersistenceMet,
      forecastRunPersistenceMet: false,
      previousInternalState: previousState.internalState,
      newInternalState: previousState.internalState, // 状態機構を使わないため変化なし
      isCandidate: rainCondition === "met",
      reason:
        rainCondition === "met"
          ? "降雨条件のみで判定(比較対照。本番候補ではない)"
          : rainCondition === "insufficient_data"
            ? "降雨予測データ不足"
            : "降雨条件を満たさない",
      updatedState: previousState, // Method1は状態を更新しない(独立した比較のため)
    };
  }

  // --- ハザードゲート(Method2〜4共通、PART9) ---
  if (staticFloodHazardStatus === "unknown") {
    return {
      method,
      rainCondition,
      forecastInternalPersistenceMet,
      forecastRunPersistenceMet: false,
      previousInternalState: previousState.internalState,
      newInternalState: "normal",
      isCandidate: false,
      reason: "staticFloodHazardがunknown(データ不足。安全とは扱わずPush対象外として記録)",
      updatedState: { internalState: "normal", persistence: previousState.persistence },
    };
  }
  if (staticFloodHazardStatus === "outside") {
    return {
      method,
      rainCondition,
      forecastInternalPersistenceMet,
      forecastRunPersistenceMet: false,
      previousInternalState: previousState.internalState,
      newInternalState: "normal",
      isCandidate: false,
      reason: "洪水ハザード区域外(絶対安全とは断定しないが、原則Push対象外)",
      updatedState: { internalState: "normal", persistence: previousState.persistence },
    };
  }

  // --- run間継続性の更新(同一runの重複evaluationはskip扱い、PART4・6) ---
  // 【重要】runInitialisationTimeがあればそれをrunの同一性判定に使い、
  // 無い場合(標準forecast API使用時)のみcontentHashにフォールバックする
  // (resolveRunKey参照。run再現性監査での修正点)。
  const runKey = resolveRunKey(forecast);
  const sameRun = runKey === previousState.persistence.lastEvaluatedRunKey;
  const updatedPersistence: PersistenceTracking = sameRun
    ? previousState.persistence
    : {
        consecutiveRunsMatched: rainCondition === "met" ? previousState.persistence.consecutiveRunsMatched + 1 : 0,
        lastEvaluatedRunKey: runKey,
      };
  const forecastRunPersistenceMet = updatedPersistence.consecutiveRunsMatched >= config.requiredConsecutiveRuns;

  // --- Method2: Hazard + Rain（状態変化を見ない。毎回そのまま候補判定） ---
  if (method === "hazard_and_rain") {
    const isCandidate = rainCondition === "met";
    return {
      method,
      rainCondition,
      forecastInternalPersistenceMet,
      forecastRunPersistenceMet,
      previousInternalState: previousState.internalState,
      newInternalState: isCandidate ? "candidate_unconfirmed" : "normal",
      isCandidate,
      reason: isCandidate
        ? "洪水ハザード区域内 かつ 降雨条件成立(状態変化は考慮しない)"
        : rainCondition === "insufficient_data"
          ? "降雨予測データ不足"
          : "降雨条件を満たさない",
      updatedState: {
        internalState: isCandidate ? "candidate_unconfirmed" : "normal",
        persistence: updatedPersistence,
      },
    };
  }

  // --- Method3・Method4共通: 状態遷移を計算 ---
  const conditionHolds = rainCondition === "met";
  const persistenceConfirmed = forecastInternalPersistenceMet || forecastRunPersistenceMet;

  let newInternalState: NotificationInternalState;
  if (!conditionHolds) {
    newInternalState = "normal";
  } else if (method === "hazard_rain_state_change_persistence" && persistenceConfirmed) {
    newInternalState = "candidate_confirmed";
  } else {
    newInternalState = "candidate_unconfirmed";
  }

  const updatedState: NotificationPointState = { internalState: newInternalState, persistence: updatedPersistence };

  if (method === "hazard_rain_state_change") {
    // Method3: normalから一段階でも上昇した瞬間のみ候補(PART4)。
    // 低下時・同じ状態が続く間は候補にしない。
    const isCandidate = previousState.internalState === "normal" && newInternalState !== "normal";
    return {
      method,
      rainCondition,
      forecastInternalPersistenceMet,
      forecastRunPersistenceMet,
      previousInternalState: previousState.internalState,
      newInternalState,
      isCandidate,
      reason: isCandidate
        ? "状態がnormalから上昇(新規候補)"
        : newInternalState === "normal"
          ? previousState.internalState !== "normal"
            ? "状態が低下(通知不要、ログのみ記録)"
            : rainCondition === "insufficient_data"
              ? "降雨予測データ不足"
              : "降雨条件を満たさない"
          : "同じ状態が継続(重複通知を抑制)",
      updatedState,
    };
  }

  // Method4: candidate_confirmedへ新たに到達した場合のみ候補
  const isCandidate = previousState.internalState !== "candidate_confirmed" && newInternalState === "candidate_confirmed";
  return {
    method,
    rainCondition,
    forecastInternalPersistenceMet,
    forecastRunPersistenceMet,
    previousInternalState: previousState.internalState,
    newInternalState,
    isCandidate,
    reason: isCandidate
      ? `継続性を確認し候補化(forecast内継続=${forecastInternalPersistenceMet}, run間継続=${forecastRunPersistenceMet})`
      : newInternalState === "candidate_confirmed"
        ? "confirmed状態が継続(重複通知を抑制)"
        : newInternalState === "candidate_unconfirmed"
          ? "降雨条件は成立したが継続性が未確認"
          : previousState.internalState !== "normal"
            ? "状態が低下(通知不要、ログのみ記録)"
            : rainCondition === "insufficient_data"
              ? "降雨予測データ不足"
              : "降雨条件を満たさない",
    updatedState,
  };
}
