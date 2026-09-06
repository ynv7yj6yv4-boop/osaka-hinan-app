"use client";

import { RISK_LEVEL_INFO, type RiskResult } from "@/lib/riskAssessment";

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
      <div className="mx-3 mt-2 rounded-xl border-2 border-zinc-300 bg-white px-4 py-3 text-zinc-600">
        現在地の災害リスクを判定しています…
      </div>
    );
  }

  if (!result) return null;

  const info = RISK_LEVEL_INFO[result.level];

  return (
    <button
      type="button"
      onClick={onOpenDetail}
      className="mx-3 mt-2 flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-left shadow-sm active:opacity-80"
      style={{ borderColor: info.color, backgroundColor: info.bgColor }}
    >
      <span className="text-3xl leading-none" aria-hidden>
        {info.emoji}
      </span>
      <span className="flex-1">
        <span className="block text-xs text-zinc-600">
          現在地の災害リスク（静的なハザード情報に基づく参考評価）
        </span>
        <span className="block text-xl font-bold" style={{ color: info.color }}>
          {info.label}
        </span>
        {result.assessmentCompleteness === "partial" && (
          <span className="mt-0.5 block text-xs font-bold text-amber-700">
            ⚠ 一部のハザード情報を確認できていません
          </span>
        )}
      </span>
      <span className="text-sm font-bold text-zinc-500 underline shrink-0">理由を見る</span>
    </button>
  );
}
