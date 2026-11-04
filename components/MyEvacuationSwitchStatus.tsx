"use client";

// マイ避難スイッチのホーム画面表示。地図を圧迫しないよう、RiskCardの直下に
// 1行（ON時のみ2行）のボタンだけを置き、詳しい説明と行動導線は押したとき
// （またはONになった瞬間）に既存のModal（スマートフォンではBottom Sheet）で出す。
//
// 【重要】ここで扱うのは「現在確認している地点」の参考評価に基づく状態であり、
// 「ユーザーが危険」という表現・自治体の避難指示と誤認される断定表現は使わない
// （文言はlib/myEvacuationSwitchMessages.tsに集約）。

import type { ComponentType, CSSProperties } from "react";
import type { RiskLevel } from "@/lib/riskAssessment";
import { RISK_LEVEL_INFO } from "@/lib/riskAssessment";
import { formatPreviousCheckedAt } from "@/lib/riskHistory";
import {
  DEFAULT_SWITCH_CRITERIA,
  type MyEvacuationSwitchState,
  type RecordSwitchStateResult,
} from "@/lib/myEvacuationSwitch";
import { describeMyEvacuationSwitch, MY_EVACUATION_SWITCH_STATE_LABEL } from "@/lib/myEvacuationSwitchMessages";
import Modal from "./ui/Modal";
import Button from "./ui/Button";
import { DangerIcon, WarningIcon, InfoIcon, UnknownIcon, ChevronDownIcon } from "./ui/icons";

export type MyEvacuationSwitchStatusValue = RecordSwitchStateResult & { riskLevel: RiskLevel };

const STATE_STYLE: Record<
  MyEvacuationSwitchState,
  { icon: ComponentType<{ className?: string; style?: CSSProperties }>; fg: string; surface: string; border: string }
> = {
  on: {
    icon: DangerIcon,
    fg: "var(--color-danger)",
    surface: "var(--color-danger-surface)",
    border: "var(--color-danger-border)",
  },
  prepare: {
    icon: WarningIcon,
    fg: "var(--color-warning)",
    surface: "var(--color-warning-surface)",
    border: "var(--color-warning-border)",
  },
  off: {
    icon: InfoIcon,
    fg: "var(--color-text-secondary)",
    surface: "var(--color-surface)",
    border: "var(--color-border)",
  },
  unknown: {
    icon: UnknownIcon,
    fg: "var(--color-risk-unknown)",
    surface: "var(--color-risk-unknown-surface)",
    border: "var(--color-risk-unknown-border)",
  },
};

/** 現在の目安（設定画面・詳細シートで共通に使う説明）。 */
export function criteriaText(): { prepare: string; on: string } {
  return {
    prepare: `災害リスク（参考評価）が「${RISK_LEVEL_INFO[DEFAULT_SWITCH_CRITERIA.prepareAt].label}」`,
    on: `災害リスク（参考評価）が「${RISK_LEVEL_INFO[DEFAULT_SWITCH_CRITERIA.onAt].label}」以上`,
  };
}

export function MyEvacuationSwitchStatusRow({
  status,
  onOpen,
}: {
  status: MyEvacuationSwitchStatusValue;
  onOpen: () => void;
}) {
  const s = STATE_STYLE[status.state];
  const Icon = s.icon;
  const message = describeMyEvacuationSwitch(status.state, status.transition);
  // 1行に収めるため、ホーム画面では常に短い「マイ避難スイッチ：状態」の形にする
  // （「ONになりました」等の見出しは詳細シート側で表示する）。
  const rowTitle = `マイ避難スイッチ：${MY_EVACUATION_SWITCH_STATE_LABEL[status.state]}`;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={`${rowTitle}。${message.body}詳しく見る`}
      className="flex min-h-11 w-full items-center gap-2 rounded-[var(--radius-lg)] border-2 px-3.5 py-2 text-left shadow-[var(--shadow-sm)]"
      style={{ borderColor: s.border, backgroundColor: s.surface }}
    >
      <Icon className="h-5 w-5 shrink-0" style={{ color: s.fg }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold" style={{ color: status.state === "off" ? "var(--color-text-primary)" : s.fg }}>
          {rowTitle}
        </span>
        {status.state === "on" && (
          <span className="block text-xs leading-snug text-[var(--color-text-primary)]">{message.body}</span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-0.5 text-xs font-bold text-[var(--color-primary)]">
        確認する
        <ChevronDownIcon className="h-4 w-4 shrink-0 -rotate-90" />
      </span>
    </button>
  );
}

export function MyEvacuationSwitchDetailSheet({
  status,
  onClose,
  onShowShelters,
  onShowRoute,
  hasRoute,
  onShowOfficialInfo,
  onOpenSettings,
}: {
  status: MyEvacuationSwitchStatusValue;
  onClose: () => void;
  onShowShelters: () => void;
  onShowRoute: () => void;
  /** 以前に確認した避難ルートがあるか（無い場合は避難先を選んでからルートを確認する）。 */
  hasRoute: boolean;
  onShowOfficialInfo: () => void;
  onOpenSettings: () => void;
}) {
  const s = STATE_STYLE[status.state];
  const Icon = s.icon;
  const message = describeMyEvacuationSwitch(status.state, status.transition);
  const criteria = criteriaText();
  const showEvacuationActions = status.state === "on" || status.state === "prepare";

  return (
    <Modal title="マイ避難スイッチ" onClose={onClose}>
      <div
        className="rounded-[var(--radius-md)] border-2 px-3.5 py-3"
        style={{ borderColor: s.border, backgroundColor: s.surface }}
      >
        <p className="flex items-center gap-2 text-base font-bold" style={{ color: status.state === "off" ? "var(--color-text-primary)" : s.fg }}>
          <Icon className="h-5 w-5 shrink-0" style={{ color: s.fg }} />
          {message.title}
        </p>
        <p className="mt-1.5 text-base leading-relaxed text-[var(--color-text-primary)]">{message.body}</p>
        {message.note && <p className="mt-1 text-sm leading-snug text-[var(--color-text-secondary)]">{message.note}</p>}
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {showEvacuationActions && (
          <>
            <Button variant={status.state === "on" ? "primary" : "secondary"} fullWidth onClick={onShowShelters}>
              避難先を見る
            </Button>
            <Button variant="secondary" fullWidth onClick={onShowRoute}>
              避難ルートを見る
            </Button>
            {!hasRoute && (
              <p className="text-xs leading-snug text-[var(--color-text-muted)]">
                ※避難ルートは、避難先の候補を選ぶと確認できます。
              </p>
            )}
          </>
        )}
        <Button variant="secondary" fullWidth onClick={onShowOfficialInfo}>
          公式情報を見る
        </Button>
      </div>

      <section className="mt-4 rounded-[var(--radius-md)] bg-[var(--color-surface-subtle)] p-3.5 text-sm text-[var(--color-text-secondary)]">
        <h3 className="font-bold text-[var(--color-text-primary)]">判定のもと</h3>
        <p className="mt-1 leading-snug">
          現在確認している地点の災害リスク（参考評価）：
          <span className="font-bold text-[var(--color-text-primary)]">{RISK_LEVEL_INFO[status.riskLevel].label}</span>
        </p>
        {status.state !== "unknown" && status.changedAt && (
          <p className="mt-0.5 leading-snug">この状態になった時刻：{formatPreviousCheckedAt(status.changedAt)}</p>
        )}
        <ul className="mt-2 space-y-0.5 text-xs leading-snug">
          <li>準備の目安：{criteria.prepare}</li>
          <li>ONの目安：{criteria.on}</li>
        </ul>
        <p className="mt-2 text-xs leading-relaxed text-[var(--color-text-muted)]">
          ※このアプリ独自の参考評価であり、自治体が発令する避難情報ではありません。災害リスクは、浸水想定区域と今後24時間の予想雨量に基づいて判定しています（予想雨量を取得できない場合は浸水想定のみ）。
        </p>
        <button
          type="button"
          onClick={onOpenSettings}
          className="mt-1 flex min-h-11 items-center gap-1 text-sm font-bold text-[var(--color-primary)]"
        >
          マイ避難スイッチの設定を開く
          <ChevronDownIcon className="h-4 w-4 -rotate-90" />
        </button>
      </section>
    </Modal>
  );
}
