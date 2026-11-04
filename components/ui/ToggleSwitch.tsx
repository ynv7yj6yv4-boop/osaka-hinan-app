"use client";

// 機能の有効/無効を切り替えるスイッチ（role="switch"）。タップ領域は44px以上を確保し、
// 色だけに頼らないよう「有効」「無効」の文字を常に併記する。

export default function ToggleSwitch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** スクリーンリーダー向けの名前（例: 「マイ避難スイッチ」）。 */
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex min-h-11 shrink-0 items-center gap-2 rounded-full px-1 disabled:opacity-60"
    >
      <span className="w-8 text-right text-sm font-bold text-[var(--color-text-secondary)]" aria-hidden>
        {checked ? "有効" : "無効"}
      </span>
      <span
        aria-hidden
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 transition-colors motion-reduce:transition-none ${
          checked
            ? "border-[var(--color-primary)] bg-[var(--color-primary)]"
            : "border-[var(--color-border-strong)] bg-[var(--color-surface-subtle)]"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white shadow-[var(--shadow-sm)] transition-transform motion-reduce:transition-none ${
            checked ? "translate-x-[22px]" : "translate-x-[2px]"
          }`}
        />
      </span>
    </button>
  );
}
