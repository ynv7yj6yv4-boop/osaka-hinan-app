"use client";

// UI刷新: デジタル庁デザインシステムのボタン階層(Primary/Secondary/Tertiary)を
// 参考にした共通ボタン。既存の各所に散らばっていたボタンスタイルを整理する。
// 【重要】これは見た目の共通化のみが目的で、クリック時の挙動は呼び出し側の
// onClick等でこれまでどおり実装する(このコンポーネント自体は業務ロジックを持たない)。

import { type ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "tertiary" | "danger-outline";
type Size = "md" | "lg" | "sm";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-[var(--color-primary)] text-[var(--color-text-on-primary)] border border-transparent active:bg-[var(--color-primary-hover)] hover:bg-[var(--color-primary-hover)] disabled:bg-zinc-300 disabled:text-zinc-500",
  secondary:
    "bg-[var(--color-surface)] text-[var(--color-text-primary)] border-2 border-[var(--color-border-strong)] active:bg-[var(--color-surface-subtle)] hover:bg-[var(--color-surface-subtle)] disabled:text-zinc-400 disabled:border-zinc-200",
  tertiary:
    "bg-transparent text-[var(--color-primary)] border border-transparent underline underline-offset-2 active:text-[var(--color-primary-hover)] hover:text-[var(--color-primary-hover)] disabled:text-zinc-400 disabled:no-underline",
  "danger-outline":
    "bg-[var(--color-surface)] text-[var(--color-danger)] border-2 border-[var(--color-danger-border)] active:bg-[var(--color-danger-surface)] hover:bg-[var(--color-danger-surface)] disabled:text-zinc-400 disabled:border-zinc-200",
};

const SIZE_CLASSES: Record<Size, string> = {
  // どのサイズでも実際のタップ領域が44 CSS px以上になるよう、paddingで確保する。
  sm: "min-h-11 px-3 py-2 text-sm",
  md: "min-h-11 px-4 py-2.5 text-base",
  lg: "min-h-12 px-5 py-3.5 text-base",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", fullWidth = false, className = "", type = "button", ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] font-bold shadow-[var(--shadow-sm)] transition-colors",
        "disabled:cursor-not-allowed disabled:shadow-none",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        fullWidth ? "w-full" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
});

export default Button;
