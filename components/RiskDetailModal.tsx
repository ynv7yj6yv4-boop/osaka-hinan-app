"use client";

import { RISK_LEVEL_INFO, type RiskResult } from "@/lib/riskAssessment";

export default function RiskDetailModal({
  result,
  onClose,
}: {
  result: RiskResult;
  onClose: () => void;
}) {
  const info = RISK_LEVEL_INFO[result.level];

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-end sm:items-center sm:justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <span className="text-4xl leading-none" aria-hidden>
              {info.emoji}
            </span>
            <div>
              <div className="text-xs text-zinc-600">現在地の災害リスク</div>
              <div className="text-2xl font-bold" style={{ color: info.color }}>
                {info.label}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="rounded-full border-2 border-zinc-300 px-3 py-1 text-lg font-bold text-zinc-600"
          >
            ×
          </button>
        </div>

        <section className="mt-4">
          <h2 className="text-base font-bold text-zinc-900">判定理由</h2>
          <ul className="mt-2 space-y-1 text-base text-zinc-800">
            {result.reasons.map((reason, i) => (
              <li key={i}>・{reason}</li>
            ))}
          </ul>
        </section>

        <section className="mt-4 rounded-lg bg-zinc-50 p-3">
          <h2 className="text-base font-bold text-zinc-900">推奨行動</h2>
          <p className="mt-1 text-base text-zinc-800">{result.recommendation}</p>
        </section>

        <section className="mt-4 border-t border-zinc-200 pt-3">
          {result.disclaimers.map((d, i) => (
            <p key={i} className="mt-1 text-xs leading-relaxed text-zinc-500">
              ※{d}
            </p>
          ))}
        </section>
      </div>
    </div>
  );
}
