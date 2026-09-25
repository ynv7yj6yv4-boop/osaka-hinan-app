// 避難ルート区間別リスクの凡例。色だけに依存せず、必ず線種(破線)とテキストを併用する。

import { ROUTE_RISK_LEVEL_ORDER, ROUTE_RISK_LEVEL_PRESENTATION } from "./routeRiskPresentation";

export default function RouteRiskLegend() {
  return (
    <ul className="flex flex-col gap-1.5 text-xs text-[var(--color-text-secondary)]">
      {ROUTE_RISK_LEVEL_ORDER.map((level) => {
        const p = ROUTE_RISK_LEVEL_PRESENTATION[level];
        return (
          <li key={level} className="flex items-center gap-2">
            <svg width="28" height="8" aria-hidden className="shrink-0">
              <line
                x1="0"
                y1="4"
                x2="28"
                y2="4"
                stroke={p.leafletColor}
                strokeWidth={3}
                strokeDasharray={p.dashed ? "5 4" : undefined}
              />
            </svg>
            <span>{p.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
