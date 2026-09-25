"use client";

// 避難ルート区間別リスクの詳細表示。1区間分の理由・洪水/内水/標高情報を、
// 既存データの意味に忠実な表現で示す(「必ず冠水する」等の断定はしない)。

import type { RouteRiskSegment } from "@/lib/routeSegmentRisk";
import { TERRAIN_EVALUATION_CONFIG } from "@/lib/routeTerrainEvaluation";
import { ROUTE_RISK_LEVEL_PRESENTATION, ROUTE_RISK_REASON_TEXT } from "./routeRiskPresentation";

// 既存のEvacuationPanel.tsxのDEPTH_RANK_LABELSと同じ簡略化(rank5を1つの
// ラベルにまとめる)。lib/hazardColorLegend.tsのDEPTH_LEGENDはrank5に
// 2つのラベル(10〜20m/20m以上)を持つため、単純なRecord<rank,label>には
// できないための既存の複製方針を踏襲している。
const DEPTH_RANK_LABELS: Record<number, string> = {
  0: "検出なし",
  1: "0.5m未満",
  2: "0.5m〜3.0m",
  3: "3.0m〜5.0m",
  4: "5.0m〜10.0m",
  5: "10.0m以上",
};

function formatMeters(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`;
}

function hazardText(label: string, assessment: RouteRiskSegment["flood"]): string {
  if (assessment.status === "unknown") return `${label}：この区間では評価データを取得できません`;
  return `${label}：想定浸水深 ${DEPTH_RANK_LABELS[assessment.rank]}`;
}

function relativeElevationText(relativeElevationMeters: number | null): string {
  if (relativeElevationMeters === null) return "算出できません";
  const radius = TERRAIN_EVALUATION_CONFIG.neighborhoodRadiusMeters;
  if (relativeElevationMeters < 0) {
    return `周辺${radius}mと比べて約${Math.abs(relativeElevationMeters).toFixed(1)}m低い`;
  }
  return `周辺${radius}mと比べて低くはありません（約${relativeElevationMeters.toFixed(1)}m）`;
}

export default function RouteRiskDetail({ segment }: { segment: RouteRiskSegment }) {
  const p = ROUTE_RISK_LEVEL_PRESENTATION[segment.riskLevel];

  return (
    <div className="mt-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3 text-sm">
      <p className="font-bold" style={{ color: p.cssColor }}>
        {p.label}
      </p>
      <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
        始点から約{formatMeters(segment.startDistanceMeters)}〜{formatMeters(segment.endDistanceMeters)}の区間
      </p>

      <p className="mt-2 text-[var(--color-text-primary)]">{hazardText("洪水浸水想定", segment.flood)}</p>
      <p className="mt-1 text-[var(--color-text-primary)]">{hazardText("内水氾濫浸水想定", segment.inlandFlood)}</p>
      <p className="mt-1 text-[var(--color-text-primary)]">
        標高：{segment.elevationMeters !== null ? `約${segment.elevationMeters.toFixed(1)}m` : "取得できません"}
      </p>
      <p className="mt-1 text-[var(--color-text-primary)]">
        相対標高：{relativeElevationText(segment.relativeElevationMeters)}
      </p>

      <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
        理由：{segment.reasons.map((r) => ROUTE_RISK_REASON_TEXT[r]).join("、")}
      </p>
    </div>
  );
}
