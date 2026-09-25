// 避難ルート区間別リスクの「見せ方」だけをここに集約する。
// 【重要】lib/routeSegmentRisk.ts の判定ロジック・型には関与しない(type-importのみ)。
//
// cssColor: 通常のDOM要素(凡例・詳細パネルのテキスト色等)で使うCSS変数。
// leafletColor: Leaflet PolylineのpathOptionsに渡す実際の色。
// 【重要】LeafletのSVGレンダラーはCSSカスタムプロパティ(var(...))を
// 解決できない場合があるため、地図描画用だけは既存globals.cssの
// --color-risk-*と同じ実際の16進値を複製して使う(新しい色を増やさない)。

import type { SegmentRiskLevel, RouteRiskReason } from "@/lib/routeSegmentRisk";

export type RouteRiskLevelPresentation = {
  label: string;
  cssColor: string;
  leafletColor: string;
  dashed: boolean;
};

export const ROUTE_RISK_LEVEL_ORDER: readonly SegmentRiskLevel[] = [
  "relatively_low",
  "attention",
  "higher_attention",
  "unknown",
];

export const ROUTE_RISK_LEVEL_PRESENTATION: Record<SegmentRiskLevel, RouteRiskLevelPresentation> = {
  relatively_low: {
    label: "比較的注意度が低い区間",
    cssColor: "var(--color-risk-safe)",
    leafletColor: "#15803d",
    dashed: false,
  },
  attention: {
    label: "注意が必要な参考区間",
    cssColor: "var(--color-risk-caution)",
    leafletColor: "#8a5a00",
    dashed: false,
  },
  higher_attention: {
    label: "注意度が高い参考区間",
    cssColor: "var(--color-risk-evacuate)",
    leafletColor: "#b3261e",
    dashed: false,
  },
  unknown: {
    label: "評価できない区間",
    cssColor: "var(--color-text-muted)",
    leafletColor: "#6b7280",
    dashed: true,
  },
};

export const ROUTE_RISK_REASON_TEXT: Record<RouteRiskReason, string> = {
  flood_hazard_area: "洪水ハザード区域内",
  inland_flood_hazard_area: "内水氾濫ハザード区域内",
  relatively_low_terrain: "周辺より低い地形",
  no_significant_hazard: "明確なハザードは検出されていません",
  data_unavailable: "評価に必要な情報を取得できませんでした",
};
