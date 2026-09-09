// 試作3 PART 3（要件定義書2 PART 15）: 通知判定の閾値を設定として分離する。
//
// 【重要・最重要】enabled: false が「本番自動通知の総本山スイッチ」である。
// 万一、他のコードに不具合があっても、この値がfalseである限り
// lib/notificationDecision.ts は "candidate" を実際の送信には使わせない
// 設計にしている（安全側に倒す多重防御）。
//
// ここに並んでいる具体的な数値（rainfallRankThreshold等）は、
// 「研究用に検討している候補」であり、
// 「妥当性が確認された最終値」ではない。実装前の暫定値であることを
// data/README.md にも明記すること。
// 人間が閾値を確定させた後、enabledをtrueにする（このファイルの変更のみで
// 全体の挙動を切り替えられるようにし、if文をコード中に散らばらせない）。

export type NotificationDecisionConfig = {
  /** falseの間、evaluateNotificationDecision()は"candidate"を返さない(常にno_notification等) */
  enabled: boolean;
  /** 判定バージョン。ロジック・閾値を変更したら必ず更新する(研究ログ用)。 */
  decisionVersion: string;
  /** 対象ハザード。試作3時点では洪水のみ(要件定義書2 PART 9)。 */
  targetHazard: "flood";
  /** 予測の何分先までを判定に使うか（候補値。根拠はPART4報告参照） */
  forecastHorizonMinutes: number;
  /** 降雨強度がこのrank(lib/rainfallColorLegend.tsのrank, 1〜8)以上で「強い雨」とみなす候補値 */
  rainfallRankThreshold: number;
  /** 静的浸水想定区域のdepthRank(lib/hazardColorLegend.tsのDepthRank, 0〜5)がこの値以上を対象とする候補値 */
  hazardDepthRankThreshold: number;
  /** 同一地点への再通知を抑制する最短間隔(分)の候補値 */
  cooldownMinutes: number;
  /**
   * 【要件定義書3・このアプリの中心的な設計思想】
   * 「大雨が予測されたので通知する」のではなく、「これから降り続けると
   * 予測される総雨量が、道路の冠水を引き起こしうる規模かどうか」を判断して
   * から通知する。この2つ(totalRainfallWindowHours・totalRainfallThresholdMm)
   * が、そのための予測総雨量ベースの判定パラメータ。
   * lib/floodRiskForecast.ts(Open-Meteo/JMA MSM、mm単位)を使う。
   *
   * 【重要・未確定】ここに入っている数値は「研究上の代理指標(proxy)の
   * 暫定候補」であり、「この量が降ったら実際に道路が冠水する」ことを
   * 検証済みの物理モデル・実測データに基づくものではない
   * (要件定義書3 §9・10の制約は解消されていない)。人間側の確認・承認が
   * 必要（詳細はdata/README.md参照）。
   */
  /** 今後何時間分の予測降水量を合計するか(候補値・未確定) */
  totalRainfallWindowHours: number;
  /** 上記windowHours内の予測総雨量(mm)がこの値以上で「冠水リスクあり」とみなす候補値(未確定) */
  totalRainfallThresholdMm: number;
};

// 【重要】以下の数値は「研究用に比較検討している候補」であり、
// 気象庁・国土交通省等の一次資料による裏付けが不十分なため、
// enabled: false のまま維持すること。人間が確認・承認するまで
// true にしないこと（要件定義書2 PART F-3・14）。
export const notificationDecisionConfig: NotificationDecisionConfig = {
  enabled: false,
  decisionVersion: "framework-only-v0",
  targetHazard: "flood",
  forecastHorizonMinutes: 30,
  rainfallRankThreshold: 6, // rank6 = 30〜50mm/h程度(激しい雨)。PART4報告で根拠を検討する
  hazardDepthRankThreshold: 1, // 0.5m未満でも「区域内」であれば対象とする候補
  cooldownMinutes: 60,
  // 【重要・未確定・仮値】24時間で100mmという値は、防災の文脈でしばしば
  // 「大雨」の目安として言及される丸めた数字であり、この地点で実際に道路が
  // 冠水することを検証した一次資料ではない。要件定義書3の人間側確認が
  // 必要（data/README.md参照）。
  totalRainfallWindowHours: 24,
  totalRainfallThresholdMm: 100,
};
