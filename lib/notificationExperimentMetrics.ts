// 試作3 通知判定ロジックの実験実装 PART14・15: 通知疲れを評価するための指標。
//
// 【重要】ここでの「降雨イベント」の分離には、水文学・都市排水分野で
// 使われる IETD (Inter-Event Time Definition) の考え方を採用する。
// IETDは「2つの独立した降雨を分けるために必要な、最低限の無降雨時間」
// として定義される学術的な概念であり、具体的な時間数は研究・地域に
// よって様々な値が使われる(自己相関分析・年間イベント数分析・変動係数
// 分析等の統計的手法で求めるのが一般的)。
// 出典: IETD R package (CRAN) https://cran.r-project.org/web/packages/IETD/IETD.pdf
// 【重要】本実装は具体的なIETD値(例:6時間)を確定させず、実験パラメータ
// として外部から指定できるようにしている。

export type RainfallHourPoint = { time: string; precipitationMm: number | null };

export type RainfallEvent = {
  eventId: string;
  startTime: string;
  endTime: string;
  /** イベント内の最大時間雨量(mm)。欠測のみの区間ならnull */
  peakHourlyRainfallMm: number | null;
};

/**
 * IETD(無降雨とみなす連続時間, 時間単位)に基づき、時系列を独立した
 * 降雨イベントへ分割する（純粋関数）。
 * 【重要】欠測(null)は「無降雨(0mm)」とは区別せず、有無判定からは除外する
 * (欠測期間だけでイベントが分断されたと誤判定しないよう、欠測は
 * 直前の降雨/無降雨状態を継続しているとみなす保守的な扱いとする)。
 */
export function splitIntoRainfallEvents(hourly: RainfallHourPoint[], ietdHours: number): RainfallEvent[] {
  const events: RainfallEvent[] = [];
  let current: { start: number; end: number; peak: number | null } | null = null;
  let dryHours = 0;

  for (let i = 0; i < hourly.length; i++) {
    const v = hourly[i].precipitationMm;
    const isRaining = v !== null && v > 0;

    if (isRaining) {
      if (!current) {
        current = { start: i, end: i, peak: v };
      } else {
        current.end = i;
        current.peak = current.peak === null ? v : Math.max(current.peak, v);
      }
      dryHours = 0;
    } else if (v === 0) {
      dryHours++;
      if (current && dryHours >= ietdHours) {
        events.push(finalizeEvent(hourly, current, events.length));
        current = null;
        dryHours = 0;
      }
    }
    // v === null(欠測)の場合はdryHoursを進めない(保守的に「継続中」とみなす)
  }
  if (current) events.push(finalizeEvent(hourly, current, events.length));

  return events;
}

function finalizeEvent(
  hourly: RainfallHourPoint[],
  current: { start: number; end: number; peak: number | null },
  index: number
): RainfallEvent {
  return {
    eventId: `event-${index + 1}`,
    startTime: hourly[current.start].time,
    endTime: hourly[current.end].time,
    peakHourlyRainfallMm: current.peak,
  };
}

// ============================================================
// PART14: 主要評価指標
// ============================================================

export type MethodDecisionRecord = {
  timestamp: string;
  isCandidate: boolean;
  rainCondition: "met" | "not_met" | "insufficient_data";
};

export type ExperimentMetrics = {
  /** 1. 雨天日1日あたりの通知候補数 */
  notificationCandidatesPerRainyDay: number | null;
  /** 2. 1降雨イベントあたりの通知候補数 */
  notificationCandidatesPerEvent: number | null;
  /** 3. 状態変化・cooldown等によって抑制できた重複通知候補の件数
   *  (Method2的な「毎回候補」判定と比べて、実際の候補数がどれだけ減ったか) */
  duplicateSuppressionRate: number | null;
  /** 4. 降雨イベントのうち、少なくとも1回通知候補になった割合 */
  notifiedEventRatio: number | null;
  /** 5. 弱い雨・ほぼ雨のない期間(peakHourlyRainfallMmが小さいイベント)で
   *  通知候補が発生した回数 */
  dryOrWeakRainNotificationCount: number;
  /** 6. データ不足で判断できなかった回数 */
  insufficientDataCount: number;
  totalCandidates: number;
  totalEvaluations: number;
};

export function computeExperimentMetrics(params: {
  records: MethodDecisionRecord[];
  /** 比較対象(通常はMethod2=毎回候補判定)の候補数。重複抑制率の算出に使う。 */
  baselineCandidateCount: number;
  events: RainfallEvent[];
  /** イベントが「弱い雨」とみなされるpeak雨量のしきい値(実験パラメータ)。
   *  nullなら弱い雨の判定自体を行わない。 */
  weakRainPeakThresholdMm: number | null;
  rainyDayCount: number;
}): ExperimentMetrics {
  const { records, baselineCandidateCount, events, weakRainPeakThresholdMm, rainyDayCount } = params;

  const totalCandidates = records.filter((r) => r.isCandidate).length;
  const insufficientDataCount = records.filter((r) => r.rainCondition === "insufficient_data").length;

  const notificationCandidatesPerRainyDay = rainyDayCount > 0 ? totalCandidates / rainyDayCount : null;
  const notificationCandidatesPerEvent = events.length > 0 ? totalCandidates / events.length : null;
  const duplicateSuppressionRate =
    baselineCandidateCount > 0 ? 1 - totalCandidates / baselineCandidateCount : null;

  const notifiedEventRatio = (() => {
    if (events.length === 0) return null;
    const candidateTimes = records.filter((r) => r.isCandidate).map((r) => r.timestamp);
    const notifiedEvents = events.filter((e) =>
      candidateTimes.some((t) => t >= e.startTime && t <= e.endTime)
    );
    return notifiedEvents.length / events.length;
  })();

  const dryOrWeakRainNotificationCount = (() => {
    if (weakRainPeakThresholdMm === null) return 0;
    const candidateTimes = records.filter((r) => r.isCandidate).map((r) => r.timestamp);
    let count = 0;
    for (const t of candidateTimes) {
      const event = events.find((e) => t >= e.startTime && t <= e.endTime);
      const isWeak =
        !event || (event.peakHourlyRainfallMm !== null && event.peakHourlyRainfallMm < weakRainPeakThresholdMm);
      if (isWeak) count++;
    }
    return count;
  })();

  return {
    notificationCandidatesPerRainyDay,
    notificationCandidatesPerEvent,
    duplicateSuppressionRate,
    notifiedEventRatio,
    dryOrWeakRainNotificationCount,
    insufficientDataCount,
    totalCandidates,
    totalEvaluations: records.length,
  };
}
