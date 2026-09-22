"use client";

import type { RiskResult } from "@/lib/riskAssessment";
import { RISK_PRESENTATION } from "./riskLevelPresentation";
import MonitoringPointSection from "./MonitoringPointSection";
import Modal from "./ui/Modal";
import Notice from "./ui/Notice";

// 内部の英語表現(complete/partial/unavailable)を、一般ユーザー向けの日本語に変換する。
// 試作2: 高潮を研究対象から除外したため、対象ハザードは洪水・内水氾濫の2つ
// （lib/riskAssessment.ts の hazardKeys と対応させる）。
const COMPLETENESS_TEXT: Record<RiskResult["assessmentCompleteness"], { label: string; detail: string }> = {
  complete: {
    label: "すべて確認できました",
    detail: "洪水・内水氾濫のすべてについて、ハザード情報を確認できました。",
  },
  partial: {
    label: "一部確認できていません",
    detail: "洪水・内水氾濫の一部について、ハザード情報を確認できませんでした。表示している危険度は、確認できた情報のみに基づいています。",
  },
  unavailable: {
    label: "確認できませんでした",
    detail: "洪水・内水氾濫のいずれについても、ハザード情報を確認できませんでした。",
  },
};

export default function RiskDetailModal({
  result,
  onClose,
}: {
  result: RiskResult;
  onClose: () => void;
}) {
  const p = RISK_PRESENTATION[result.level];
  const Icon = p.icon;

  return (
    <Modal
      onClose={onClose}
      labelledBy="risk-detail-heading"
      leading={
        <span className="flex items-center gap-2.5">
          <Icon className="h-7 w-7 shrink-0" style={{ color: p.fg }} />
          <span>
            <span className="block text-xs font-medium text-[var(--color-text-secondary)]">現在地の災害リスク</span>
            <span id="risk-detail-heading" className="block text-xl font-bold" style={{ color: p.fg }}>
              {p.label}
            </span>
          </span>
        </span>
      }
    >
      <Notice tone="info" title="このリスク評価は自治体等の公式な避難指示ではありません">
        大阪市を対象とした静的なハザードマップに基づく参考情報です。公式の避難情報は必ず自治体等の発表をご確認ください。
      </Notice>

      <section className="mt-4">
        <h3 className="text-base font-bold text-[var(--color-text-primary)]">次に確認するとよいこと</h3>
        <p className="mt-1 text-base leading-relaxed text-[var(--color-text-primary)]">{p.action}</p>
      </section>

      <section className="mt-4 rounded-[var(--radius-md)] border-2 border-[var(--color-info-border)] bg-[var(--color-info-surface)] p-3.5">
        <h3 className="text-base font-bold text-[var(--color-text-primary)]">現在の降雨（参考情報）</h3>
        {result.rainfall.status === "observed" ? (
          <>
            <p className="mt-1 text-base text-[var(--color-text-primary)]">{result.rainfall.approxRange}</p>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              気象庁レーダーによる {result.rainfall.dataTimeLabel} 時点のデータ（目安）
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            現在の降雨データを取得できないため、降雨状況は判定に反映していません。
          </p>
        )}
        <p className="mt-2 text-xs font-bold text-[var(--color-info)]">
          ※この降雨情報は、下記の「現在地の災害リスク」の判定にはまだ反映されていません（今後のPhaseで対応予定）。
        </p>
      </section>

      <section className="mt-4">
        <h3 className="text-base font-bold text-[var(--color-text-primary)]">判定理由（静的なハザード情報）</h3>
        <ul className="mt-2 space-y-1 text-base text-[var(--color-text-primary)]">
          {result.reasons.map((reason, i) => (
            <li key={i}>・{reason}</li>
          ))}
        </ul>
      </section>

      <section className="mt-4">
        <h3 className="text-base font-bold text-[var(--color-text-primary)]">判定状況</h3>
        <p className="mt-1 text-base text-[var(--color-text-primary)]">
          {COMPLETENESS_TEXT[result.assessmentCompleteness].label}
        </p>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          {COMPLETENESS_TEXT[result.assessmentCompleteness].detail}
        </p>
      </section>

      <section className="mt-4 rounded-[var(--radius-md)] bg-[var(--color-surface-subtle)] p-3.5">
        <h3 className="text-base font-bold text-[var(--color-text-primary)]">推奨行動</h3>
        <p className="mt-1 text-base text-[var(--color-text-primary)]">{result.recommendation}</p>
      </section>

      <MonitoringPointSection position={result.position} />

      <section className="mt-4 border-t border-[var(--color-border)] pt-3">
        {result.disclaimers.map((d, i) => (
          <p key={i} className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
            ※{d}
          </p>
        ))}
      </section>
    </Modal>
  );
}
