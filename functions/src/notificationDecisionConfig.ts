// 【重要・保守メモ】このファイルは Next.js アプリ側の
// lib/notificationDecisionConfig.ts と内容を同期させること。
// Firebase Functionsは独立したデプロイ単位(それぞれ別のnode_modulesを持つ)
// のため、モノレポ共有パッケージ化はせず、意図的にこの小さな純粋ファイルのみ
// コピーしている。変更する場合は両方のファイルを同時に更新すること。
//
// 試作3 PART 3（要件定義書2 PART 15）: 通知判定の閾値を設定として分離する。
//
// 【重要・最重要】enabled: false が「本番自動通知の総本山スイッチ」である。
// 万一、他のコードに不具合があっても、この値がfalseである限り
// notificationDecision.ts は "candidate" を実際の送信には使わせない
// 設計にしている（安全側に倒す多重防御）。

export type NotificationDecisionConfig = {
  enabled: boolean;
  decisionVersion: string;
  targetHazard: "flood";
  forecastHorizonMinutes: number;
  rainfallRankThreshold: number;
  hazardDepthRankThreshold: number;
  cooldownMinutes: number;
};

// 【重要】以下の数値は「研究用に比較検討している候補」であり、
// 気象庁・国土交通省等の一次資料による裏付けが不十分なため、
// enabled: false のまま維持すること。人間が確認・承認するまでtrueにしない。
export const notificationDecisionConfig: NotificationDecisionConfig = {
  enabled: false,
  decisionVersion: "framework-only-v0",
  targetHazard: "flood",
  forecastHorizonMinutes: 30,
  rainfallRankThreshold: 6,
  hazardDepthRankThreshold: 1,
  cooldownMinutes: 60,
};
