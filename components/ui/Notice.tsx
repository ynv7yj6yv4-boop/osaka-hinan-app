// UI刷新: デジタル庁デザインシステムの「ノティフィケーションバナー」の考え方
// (アイコン+タイトルを必須とする4つのセマンティックタイプ)を参考にした、
// このアプリ用の軽量な通知/注意表示。
//
// 【重要】このアプリ独自のリスク判定は、公式の緊急時バナーと同等の強い表現を
// 常時使わない方針(要件)のため、"danger"も含め常に落ち着いたトーンで表示する
// (点滅・全画面赤塗り等は行わない)。

import type { ReactNode } from "react";
import { InfoIcon, SuccessIcon, WarningIcon, DangerIcon } from "./icons";

type Tone = "info" | "success" | "warning" | "danger";

const TONE_CLASSES: Record<Tone, string> = {
  info: "bg-[var(--color-info-surface)] border-[var(--color-info-border)] text-[var(--color-info)]",
  success: "bg-[var(--color-success-surface)] border-[var(--color-success-border)] text-[var(--color-success)]",
  warning: "bg-[var(--color-warning-surface)] border-[var(--color-warning-border)] text-[var(--color-warning)]",
  danger: "bg-[var(--color-danger-surface)] border-[var(--color-danger-border)] text-[var(--color-danger)]",
};

const TONE_ICON: Record<Tone, (props: { className?: string }) => ReactNode> = {
  info: InfoIcon,
  success: SuccessIcon,
  warning: WarningIcon,
  danger: DangerIcon,
};

export default function Notice({
  tone,
  title,
  children,
  className = "",
}: {
  tone: Tone;
  /** 必須。アイコンだけで意味を伝えず、常に短いタイトルを併記する。 */
  title: string;
  children?: ReactNode;
  className?: string;
}) {
  const Icon = TONE_ICON[tone];
  // 警告・危険は他の作業を中断してでも気づいてほしい情報のためrole="alert"、
  // 情報・成功は割り込まないrole="status"にする(WAI-ARIAのlive region使い分け)。
  const role = tone === "warning" || tone === "danger" ? "alert" : "status";

  return (
    <div
      role={role}
      className={`flex items-start gap-2.5 rounded-[var(--radius-md)] border-2 px-3.5 py-3 shadow-[var(--shadow-sm)] ${TONE_CLASSES[tone]} ${className}`}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0 text-[var(--color-text-primary)]">
        <p className="text-sm font-bold leading-snug">{title}</p>
        {children && <div className="mt-0.5 text-sm leading-snug text-[var(--color-text-secondary)]">{children}</div>}
      </div>
    </div>
  );
}
