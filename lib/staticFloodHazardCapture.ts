// 試作3 要件定義書3 §71〜73 / PART A〜K: staticFloodHazard方式B
// （既存ブラウザ判定 → 研究用固定JSON）の中核となる、ネットワーク非依存の変換ロジック。
//
// 【方式Bの位置づけ・重要】
// これは Notification Backtest 研究専用のデータ生成パイプラインであり、
// 本番Firebase監視用の最終方式ではない（要件定義書3 §66・67・PART B）。
// 将来、任意地点をFirebase Scheduled Functionsで自動判定する本番方式には、
// Node.js側でのPNGデコード等（方式A）が別途必要になる。
//
// 新しい洪水判定アルゴリズムは一切作らない。ここで行うのは、
// lib/hazardPixelClassifier.ts（既存・検証済み。ブラウザのCanvas APIに依存するため
// 呼び出しはクライアント側で行う）の判定結果を、研究用に保存できる形へ
// 変換・組み立てするだけの純粋関数群である（PART A）。
// 404 = unknown（outsideにしない）等の既存ルールは、ここでは一切変更しない
// （判定そのものはhazardPixelClassifier側で確定済みの値をそのまま受け取る）。

import type { HazardPixelStatus } from "./hazardPixelClassifier";
import type { DepthRank } from "./hazardColorLegend";
import { RULE_VERSION } from "./judgmentLog.ts";

/** staticFloodHazard方式B（このデータ生成パイプライン自体）のバージョン。 */
export const STATIC_FLOOD_HAZARD_CAPTURE_VERSION = "static-flood-hazard-capture-method-b-v1";

export const HAZARD_DATA_SOURCE =
  "国土交通省 ハザードマップポータルサイト「重ねるハザードマップ」洪水浸水想定区域データ（想定最大規模 L2）";

// ============================================================
// 研究地点入力（PART C・D・J）
// ============================================================

/**
 * 研究地点入力。人間が直接入力してよいのはこの形のフィールドまで
 * （pointId・座標・selection関連メタデータ）。
 *
 * 【重要・PART J】floodStatus等の判定結果をここへ人間が直接書き込むことは禁止。
 * hazard判定は必ず既存コード（classifyHazardPixel）から生成する。
 *
 * 【重要・§5・PART D】selectionGroup / selectionReason は、後から地点選定の
 * 恣意性を確認できるようにするための研究metadataである。「河川沿い」
 * 「都心」「低地」「高地」等の意味のある分類は、まだ人間側で正式決定していない。
 * 本実験地点が決まるまでは、パイプライン確認用であることが分かる中立的な値
 * （例: "technical_verification"）のみを使うこと。
 *
 * 【技術確認2回目・追記】technicalVerificationOnly: trueの地点は、
 * パイプライン動作確認専用であり、本実験の地点数・地点選定には一切含めない
 * （本実験地点が決まっていない現段階では、実質すべての地点がtrueになる）。
 */
export type ResearchMonitoringPoint = {
  pointId: string;
  latitude: number;
  longitude: number;
  selectionGroup: string;
  selectionReason: string;
  /** 結果を見てから選んだ地点でないことの記録（恣意性排除のため） */
  selectedBeforeExperiment: boolean;
  selectedAt: string;
  /** trueの間、この地点は本実験データとして一切使用しない（技術確認専用）。 */
  technicalVerificationOnly: boolean;
};

export type ResearchMonitoringPointsFile = {
  metadata: {
    // 本実験地点が未確定の間、必ずtrueにする（PART P）。
    experimentPointsFinalized: boolean;
    notes: string;
  };
  points: ResearchMonitoringPoint[];
};

// ============================================================
// Hazard Capture結果（PART E・F・G）
// ============================================================

export type FloodStatusReason = "no_tile" | "fetch_error" | "color_unknown" | "browser_error" | "other";

/**
 * 1地点分のstaticFloodHazard判定結果。
 * 【重要・PART G】判定に失敗した地点も、この形で必ず1件残す
 * （地点リストから黙って削除しない）。
 */
export type StaticFloodHazardPointResult = {
  pointId: string;
  latitude: number;
  longitude: number;
  floodStatus: "hazard" | "outside" | "unknown";
  floodStatusReason: FloodStatusReason | null;
  depthRank: DepthRank | null;
  expectedDepthLabel: string | null;
  // 洪水単体の判定完了性。lib/riskAssessment.tsのassessmentCompleteness
  // （複数ハザード共通の3値）とは異なり、ここではhazard 1件のみを対象とするため
  // "partial"は生じない（1件なのでcomplete/unavailableの2値）。
  assessmentCompleteness: "complete" | "unavailable";
  dataSource: string;
  evaluatedAt: string;
  ruleVersion: string;
  systemVersion: string;
  gitCommit: string;
  /** 入力(ResearchMonitoringPoint)のtechnicalVerificationOnlyをそのまま引き継ぐ。 */
  technicalVerificationOnly: boolean;
};

const DEPTH_LABELS: Record<DepthRank, string | null> = {
  0: null,
  1: "0.5m未満",
  2: "0.5m〜3.0m",
  3: "3.0m〜5.0m",
  4: "5.0m〜10.0m",
  5: "10.0m以上",
};

export type CaptureMeta = {
  evaluatedAt: string;
  systemVersion: string;
  gitCommit: string;
};

/**
 * classifyHazardPixel()（ブラウザ側で実行される既存ロジック）の結果を、
 * 保存用レコードへ変換する。判定内容そのものは一切変更しない（PART A・F）。
 *
 * 【禁止事項の確認（PART F）】
 * - unknown → outside への変換はしない
 * - unknown → 0(depthRank) への変換はしない
 * - unknown → low risk 相当の解釈はしない
 * いずれもこの関数では起こり得ない（switch的にunknownはunknownのまま返す）。
 */
export function toStaticFloodHazardPointResult(
  point: Pick<
    ResearchMonitoringPoint,
    "pointId" | "latitude" | "longitude" | "technicalVerificationOnly"
  >,
  pixel: HazardPixelStatus,
  meta: CaptureMeta
): StaticFloodHazardPointResult {
  const base = {
    pointId: point.pointId,
    latitude: point.latitude,
    longitude: point.longitude,
    technicalVerificationOnly: point.technicalVerificationOnly,
    dataSource: HAZARD_DATA_SOURCE,
    evaluatedAt: meta.evaluatedAt,
    ruleVersion: RULE_VERSION,
    systemVersion: meta.systemVersion,
    gitCommit: meta.gitCommit,
  };

  if (pixel.status === "hazard") {
    return {
      ...base,
      floodStatus: "hazard",
      floodStatusReason: null,
      depthRank: pixel.rank,
      expectedDepthLabel: DEPTH_LABELS[pixel.rank],
      assessmentCompleteness: "complete",
    };
  }
  if (pixel.status === "outside") {
    return {
      ...base,
      floodStatus: "outside",
      floodStatusReason: null,
      depthRank: 0,
      expectedDepthLabel: null,
      assessmentCompleteness: "complete",
    };
  }
  // unknown（no_tile / fetch_error / color_unknown）。404もここに含まれるが、
  // outsideや0へは変換せず、reasonを保持したままunknownとして残す。
  return {
    ...base,
    floodStatus: "unknown",
    floodStatusReason: pixel.reason,
    depthRank: null,
    expectedDepthLabel: null,
    assessmentCompleteness: "unavailable",
  };
}

/**
 * ブラウザ側での判定処理自体が例外を投げた場合（classifyHazardPixel呼び出し自体の失敗）の
 * レコードを組み立てる（PART G）。この場合も地点を結果から消さず、unknownとして残す。
 */
export function toCaptureFailurePointResult(
  point: Pick<
    ResearchMonitoringPoint,
    "pointId" | "latitude" | "longitude" | "technicalVerificationOnly"
  >,
  meta: CaptureMeta,
  reason: FloodStatusReason = "browser_error"
): StaticFloodHazardPointResult {
  return {
    pointId: point.pointId,
    latitude: point.latitude,
    longitude: point.longitude,
    technicalVerificationOnly: point.technicalVerificationOnly,
    floodStatus: "unknown",
    floodStatusReason: reason,
    depthRank: null,
    expectedDepthLabel: null,
    assessmentCompleteness: "unavailable",
    dataSource: HAZARD_DATA_SOURCE,
    evaluatedAt: meta.evaluatedAt,
    ruleVersion: RULE_VERSION,
    systemVersion: meta.systemVersion,
    gitCommit: meta.gitCommit,
  };
}

// ============================================================
// 固定JSON全体の組み立て（PART H・I）
// ============================================================

export type StaticFloodHazardDataset = {
  metadata: {
    generatedAt: string;
    systemVersion: string;
    gitCommit: string;
    ruleVersion: string;
    hazardDataSource: string;
    sourceURLPattern: string;
    classifierVersion: string;
    generationMethod: string;
    notes: string;
  };
  points: StaticFloodHazardPointResult[];
};

export type DatasetProvenanceInput = {
  generatedAt: string;
  systemVersion: string;
  gitCommit: string;
  sourceURLPattern: string;
  notes?: string;
};

const DEFAULT_NOTES =
  "Notification Backtest研究専用の固定データ（技術確認目的を含む）。Backtest実行のたびに最新のハザードタイルへ再アクセスするのではなく、" +
  "この時点の判定結果を再利用することで、後日タイル・外部サービス・コードが変化しても同じ研究入力で再現できるようにしている。";

/**
 * 個々の地点結果(points)に、研究再現性のためのprovenance(metadata)を付けて
 * 固定JSON全体を組み立てる（PART H・I）。
 *
 * 【再現性（テスト項目12）】同じ引数で呼び出せば、常に同じ構造のオブジェクトを返す
 * （純粋関数。ファイルI/O・現在時刻の取得はこの関数の外側=呼び出し側の責務）。
 */
export function buildStaticFloodHazardDataset(
  points: StaticFloodHazardPointResult[],
  provenance: DatasetProvenanceInput
): StaticFloodHazardDataset {
  return {
    metadata: {
      generatedAt: provenance.generatedAt,
      systemVersion: provenance.systemVersion,
      gitCommit: provenance.gitCommit,
      ruleVersion: RULE_VERSION,
      hazardDataSource: HAZARD_DATA_SOURCE,
      sourceURLPattern: provenance.sourceURLPattern,
      classifierVersion: STATIC_FLOOD_HAZARD_CAPTURE_VERSION,
      generationMethod:
        "既存ブラウザ側の洪水ハザード判定（lib/hazardPixelClassifier.ts, lib/tilePixel.ts）を" +
        "そのまま利用して生成した研究用固定データ（方式B）。新しい判定アルゴリズムは作成していない。" +
        "本番Firebase監視用の最終方式ではない（要件定義書3 §66・67）。",
      notes: provenance.notes ?? DEFAULT_NOTES,
    },
    points,
  };
}

// ============================================================
// Notification Backtest側との接続（§15 PART M・N）
// ============================================================

/**
 * Backtest結果のレポート表示用に、floodStatusを要件定義書3 PART Nの用語
 * （unknown → insufficient_data）へ変換する。
 *
 * 【重要】lib/notificationExperiment.ts の evaluateMethod()自体は、
 * StaticFloodHazardGate（"hazard" | "outside" | "unknown"）をそのまま受け取り、
 * unknownの場合はcandidateにしない・normalへ戻す、という正しい扱いを既に実装済み
 * （PART Nの要求を満たしている）。この関数は、Backtestの結果レポート上で
 * 「unknown」を用語として「insufficient_data」と表示するための、表示専用の変換である。
 */
export function toBacktestHazardStatusLabel(
  floodStatus: StaticFloodHazardPointResult["floodStatus"]
): "hazard" | "outside" | "insufficient_data" {
  return floodStatus === "unknown" ? "insufficient_data" : floodStatus;
}
