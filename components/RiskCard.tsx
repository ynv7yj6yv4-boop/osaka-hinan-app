"use client";

// UI刷新: 数秒で「今どういう状態か」「対象ハザードは何か」「次に何をすべきか」が
// 伝わるよう、状態名→一文説明→対象ハザード→行動→詳細リンク、の階層で構成する。
// 【重要】判定ロジック・値(RiskResult.level等)は一切変更していない。
// 表示だけをriskLevelPresentation.ts(UI専用)に基づいて組み立てる。

import type { RiskResult } from "@/lib/riskAssessment";
import { RISK_PRESENTATION } from "./riskLevelPresentation";
import { WarningIcon, ChevronDownIcon } from "./ui/icons";

const HAZARD_LABEL: Record<string, string> = { flood: "洪水", inundation: "内水氾濫" };

function targetHazardText(result: RiskResult): string {
  const active = result.factors.filter((f) => (f.key === "flood" || f.key === "inundation") && f.score > 0);
  if (active.length === 0) return "現時点で特に高いスコアの対象ハザードはありません";
  return `対象ハザード：${active.map((f) => HAZARD_LABEL[f.key] ?? f.label).join("・")}`;
}

export default function RiskCard({
  result,
  isLoading,
  onOpenDetail,
}: {
  result: RiskResult | null;
  isLoading: boolean;
  onOpenDetail: () => void;
}) {
  if (isLoading) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-[var(--radius-lg)] border-2 border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3.5 text-[var(--color-text-secondary)] shadow-[var(--shadow-sm)]">
        <span
          className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden
        />
        現在地の災害リスクを判定しています…
      </div>
    );
  }

  if (!result) return null;

  const p = RISK_PRESENTATION[result.level];
  const Icon = p.icon;

  return (
    <button
      type="button"
      onClick={onOpenDetail}
      className="mt-2 flex w-full items-start gap-3 rounded-[var(--radius-lg)] border-2 px-4 py-3.5 text-left shadow-[var(--shadow-sm)] transition-colors active:opacity-90"
      style={{ borderColor: p.border, backgroundColor: p.surface }}
    >
      <Icon className="mt-0.5 h-7 w-7 shrink-0" style={{ color: p.fg }} />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-[var(--color-text-secondary)]">現在地の災害リスク（参考評価）</span>
        <span className="mt-0.5 block text-xl font-bold" style={{ color: p.fg }}>
          {p.label}
        </span>
        <span className="mt-1 block text-sm leading-snug text-[var(--color-text-primary)]">{p.summary}</span>
        <span className="mt-1 block text-xs leading-snug text-[var(--color-text-secondary)]">{targetHazardText(result)}</span>
        {result.assessmentCompleteness === "partial" && (
          <span className="mt-1.5 flex items-center gap-1 text-xs font-bold text-[var(--color-warning)]">
            <WarningIcon className="h-3.5 w-3.5 shrink-0" />
            一部のハザード情報を確認できていません
          </span>
        )}
        <span className="mt-2 flex items-center gap-1 text-sm font-bold text-[var(--color-primary)]">
          くわしい理由・取るべき行動を見る
          <ChevronDownIcon className="h-4 w-4 -rotate-90" />
        </span>
      </span>
    </button>
  );
}
