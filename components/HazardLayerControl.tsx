"use client";

// スマートフォンUI改善: 常時2行分を占めていたハザード切替の横長バーを、
// コンパクトな「レイヤー」ボタン＋Bottom Sheet（既存のui/Modal.tsxを再利用）に
// 変更する。
//
// 【重要】ここで使うhazardButtons・activeHazard・onChangeは、すべて
// MapView.tsx側の既存state・既存データ（HAZARD_BUTTONS/HazardKey）を
// そのまま受け取るだけで、ハザード切替のロジック・選択肢自体は一切
// 変更していない（表示方法のみの変更）。

import type { HazardKey } from "./hazardLayers";
import Modal from "./ui/Modal";
import { LayersIcon } from "./ui/icons";
import { useId, useState } from "react";

export default function HazardLayerControl({
  hazardButtons,
  activeHazard,
  onChange,
}: {
  hazardButtons: { key: HazardKey; label: string; emoji: string }[];
  activeHazard: HazardKey | null;
  onChange: (key: HazardKey | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  const activeLabel = activeHazard
    ? hazardButtons.find((h) => h.key === activeHazard)?.label ?? null
    : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/95 px-3.5 py-2 text-sm font-bold text-[var(--color-text-primary)] shadow-[var(--shadow-sm)]"
      >
        <LayersIcon className="h-4.5 w-4.5 shrink-0 text-[var(--color-text-secondary)]" />
        {activeLabel ? `レイヤー：${activeLabel}` : "レイヤー"}
      </button>

      {open && (
        <Modal title="ハザード表示の切り替え" labelledBy={titleId} onClose={() => setOpen(false)}>
          <div role="group" aria-label="ハザード情報の表示切り替え" className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              aria-pressed={activeHazard === null}
              className={`min-h-11 rounded-[var(--radius-md)] border-2 py-2.5 text-sm font-bold ${
                activeHazard === null
                  ? "border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-white"
                  : "border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text-primary)]"
              }`}
            >
              表示しない
            </button>
            {hazardButtons.map((h) => (
              <button
                key={h.key}
                type="button"
                onClick={() => {
                  onChange(h.key);
                  setOpen(false);
                }}
                aria-pressed={activeHazard === h.key}
                className={`min-h-11 rounded-[var(--radius-md)] border-2 py-2.5 text-sm font-bold ${
                  activeHazard === h.key
                    ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                    : "border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text-primary)]"
                }`}
              >
                {h.label}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
