// UI刷新: 災害リスクレベルの「見せ方」だけをここに集約する。
//
// 【重要】lib/riskAssessment.ts のRiskLevel型・判定ロジック・
// RISK_LEVEL_INFO(既存のemoji/label/color)は一切変更していない
// (型のみをtype-importし、判定結果の意味づけには関与しない)。
// ここでは色だけに頼らないよう、アイコン・状態名・一文の説明・
// 次に確認すべき行動、をセットで用意する。
//
// 【重要】ここでの「行動」文言は、あくまでアプリ独自の参考情報であり、
// 自治体等が発令する公式の避難指示ではないことが伝わる言い回しにする。

import type { ComponentType, CSSProperties } from "react";
import type { RiskLevel } from "@/lib/riskAssessment";
import { SuccessIcon, WarningIcon, DangerIcon, UnknownIcon } from "./ui/icons";

export type RiskPresentation = {
  icon: ComponentType<{ className?: string; style?: CSSProperties }>;
  /** 既存のRISK_LEVEL_INFO.labelと同じ状態名(意味は変更しない)。 */
  label: string;
  /** 数秒で状況が伝わる一文。「避難してください」等、公式の避難指示と誤認されうる断定表現は使わない。 */
  summary: string;
  /** 次にユーザーが確認・検討するとよいこと(参考情報であることが伝わる言い回し)。 */
  action: string;
  fg: string;
  surface: string;
  border: string;
};

export const RISK_PRESENTATION: Record<RiskLevel, RiskPresentation> = {
  unknown: {
    icon: UnknownIcon,
    label: "判定情報不足",
    summary: "情報を取得できず、現在地の災害リスクを判定できませんでした。",
    action: "電波状況の良い場所で「再取得」をお試しください。",
    fg: "var(--color-risk-unknown)",
    surface: "var(--color-risk-unknown-surface)",
    border: "var(--color-risk-unknown-border)",
  },
  safe: {
    icon: SuccessIcon,
    label: "低リスク",
    summary: "現在、静的なハザード情報では低いリスクと判定されています。",
    action: "念のため、公式の気象・避難情報も定期的にご確認ください。",
    fg: "var(--color-risk-safe)",
    surface: "var(--color-risk-safe-surface)",
    border: "var(--color-risk-safe-border)",
  },
  caution: {
    icon: WarningIcon,
    label: "注意",
    summary: "静的なハザード情報から、注意が必要な区域の可能性があります。",
    action: "周辺のハザード情報を確認し、最新の気象情報にご注意ください。",
    fg: "var(--color-risk-caution)",
    surface: "var(--color-risk-caution-surface)",
    border: "var(--color-risk-caution-border)",
  },
  prepare: {
    icon: WarningIcon,
    label: "高リスク",
    summary: "静的なハザード情報から、高いリスクが想定される区域の可能性があります。",
    action: "避難先・避難ルートの確認など、事前の準備を検討してください。",
    fg: "var(--color-risk-prepare)",
    surface: "var(--color-risk-prepare-surface)",
    border: "var(--color-risk-prepare-border)",
  },
  evacuate: {
    icon: DangerIcon,
    label: "最高リスク",
    summary: "静的なハザード情報から、最も高いリスクが想定される区域の可能性があります。",
    action: "自治体等が発令する公式の避難情報を必ずご確認のうえ、行動してください。",
    fg: "var(--color-risk-evacuate)",
    surface: "var(--color-risk-evacuate-surface)",
    border: "var(--color-risk-evacuate-border)",
  },
};
