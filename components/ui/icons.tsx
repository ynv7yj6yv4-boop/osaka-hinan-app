// UI刷新: 意味を色だけに頼らず伝えるための最小限のアイコンセット。
// 新規のアイコンライブラリは追加せず、必要な数だけ手書きのinline SVGで用意する。
// すべてaria-hidden(意味は常に併記するラベル・文言側で伝える)。

import type { CSSProperties } from "react";

type IconProps = { className?: string; style?: CSSProperties };

const common = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function InfoIcon({ className, style }: IconProps) {
  return (
    <svg {...common} className={className} style={style}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16.5" />
      <circle cx="12" cy="7.5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function SuccessIcon({ className, style }: IconProps) {
  return (
    <svg {...common} className={className} style={style}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.5 2.5L16 9.5" />
    </svg>
  );
}

export function WarningIcon({ className, style }: IconProps) {
  return (
    <svg {...common} className={className} style={style}>
      <path d="M12 3.5l9.5 16.5H2.5L12 3.5z" />
      <line x1="12" y1="10" x2="12" y2="14" />
      <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function DangerIcon({ className, style }: IconProps) {
  return (
    <svg {...common} className={className} style={style}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="7.5" x2="12" y2="13" />
      <circle cx="12" cy="16" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function UnknownIcon({ className, style }: IconProps) {
  return (
    <svg {...common} className={className} style={style}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.3a2.5 2.5 0 1 1 3.6 2.2c-.9.5-1.1.9-1.1 1.8" />
      <circle cx="12" cy="16.7" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function LocationIcon({ className, style }: IconProps) {
  return (
    <svg {...common} className={className} style={style}>
      <path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.4" />
    </svg>
  );
}

export function CloseIcon({ className, style }: IconProps) {
  return (
    <svg {...common} className={className} style={style}>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

export function ChevronLeftIcon({ className, style }: IconProps) {
  return (
    <svg {...common} className={className} style={style}>
      <polyline points="15 5 8 12 15 19" />
    </svg>
  );
}

export function ChevronDownIcon({ className, style }: IconProps) {
  return (
    <svg {...common} className={className} style={style}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function BellIcon({ className, style }: IconProps) {
  return (
    <svg {...common} className={className} style={style}>
      <path d="M6 10a6 6 0 1 1 12 0c0 3.5 1 5 1.5 5.5H4.5C5 15 6 13.5 6 10z" />
      <path d="M10 18.5a2 2 0 0 0 4 0" />
    </svg>
  );
}
