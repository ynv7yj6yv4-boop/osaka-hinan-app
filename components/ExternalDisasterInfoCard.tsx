"use client";

// 河川・道路・避難所など、外部の公式情報への入口を示す共通の表示ブロック。
//
// 【重要】現時点ではlib/river・lib/road・lib/shelter-statusのどのProviderも
// 実データを取得しないため、statusToneは常に"unknown"、fetchedAtは常にnullで
// 渡される。将来Providerが実データを返すようになっても、呼び出し側の
// statusTone・statusLabel・fetchedAtを差し替えるだけでよく、この
// コンポーネント自体（見た目・構造）は変更不要な設計にしている。

import { UnknownIcon } from "./ui/icons";

export type ExternalInfoStatusTone = "unknown" | "normal" | "caution" | "warning" | "danger";

// 既存のriskLevelPresentation.tsと同じCSS変数(色トークン)を再利用する。
// 【重要】lib/riskAssessment.ts・components/riskLevelPresentation.tsは
// 一切変更していない。ここでは色トークンをvar()経由で参照するのみ。
const STATUS_TONE_COLOR: Record<ExternalInfoStatusTone, string> = {
  unknown: "var(--color-risk-unknown)",
  normal: "var(--color-risk-safe)",
  caution: "var(--color-risk-caution)",
  warning: "var(--color-risk-prepare)",
  danger: "var(--color-risk-evacuate)",
};

export type ExternalInfoSourceLink = {
  name: string;
  url: string;
};

export default function ExternalDisasterInfoCard({
  title,
  statusTone,
  statusLabel,
  description,
  sourceLinks,
  fetchedAt,
}: {
  title: string;
  statusTone: ExternalInfoStatusTone;
  statusLabel: string;
  description: string;
  sourceLinks: ExternalInfoSourceLink[];
  /** 実際にデータを取得できた日時(ISO8601)。取得していない場合はnull(「外部データ未連携」と表示)。 */
  fetchedAt: string | null;
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3">
      <div className="flex items-start gap-2">
        <UnknownIcon className="mt-0.5 h-5 w-5 shrink-0" style={{ color: STATUS_TONE_COLOR[statusTone] }} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-[var(--color-text-primary)]">{title}</p>
          <p className="mt-0.5 text-xs font-bold" style={{ color: STATUS_TONE_COLOR[statusTone] }}>
            {statusLabel}
          </p>
          <p className="mt-1 text-xs leading-snug text-[var(--color-text-secondary)]">{description}</p>
          <p className="mt-1 text-[11px] leading-snug text-[var(--color-text-muted)]">
            {fetchedAt ? `最終更新：${fetchedAt}` : "外部データ未連携"}
          </p>
          {sourceLinks.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {sourceLinks.map((link) => (
                <li key={link.url}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-primary)] px-3 text-xs font-bold text-[var(--color-primary)]"
                  >
                    {link.name}
                    <span aria-hidden>↗</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
