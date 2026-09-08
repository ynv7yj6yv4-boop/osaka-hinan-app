// 要件定義書3 docs/research-location-sampling-design.md §11: candidate population
// （洪水対応指定緊急避難場所1,733件、吹田市住所混在の1件を除く）を、既存の
// 洪水ハザード判定(lib/hazardPixelClassifier.ts)で機械的に分類した結果を保存する。
//
// 【重要】ここでの分類はstratum(hazard/outside/unknown)を決めるためだけの処理であり、
// Backtest結果を見て地点を選ぶものではない(要件定義書3の最重要ルール)。
// 新しい判定アルゴリズムはここでも作成していない。
//
// 研究専用ツールであり、本番環境では無効化する。

import { NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import type { HazardPixelStatus } from "@/lib/hazardPixelClassifier";
import { RULE_VERSION } from "@/lib/judgmentLog";
import packageJson from "../../../../package.json";

const OUTPUT_PATH = path.join(process.cwd(), "scripts", "research-data", "candidate-population-classification.json");

type RawResult = {
  id: string;
  latitude: number;
  longitude: number;
  ward: string;
  name: string;
  pixel?: HazardPixelStatus;
  captureFailed?: boolean;
};

function resolveGitCommit(): string {
  try {
    return execSync("git rev-parse HEAD", { cwd: process.cwd() }).toString().trim();
  } catch {
    return "unknown";
  }
}

function toFloodStatus(pixel?: HazardPixelStatus, captureFailed?: boolean) {
  if (captureFailed || !pixel) {
    return { floodStatus: "unknown" as const, floodStatusReason: "browser_error" as const, depthRank: null };
  }
  if (pixel.status === "hazard") return { floodStatus: "hazard" as const, floodStatusReason: null, depthRank: pixel.rank };
  if (pixel.status === "outside") return { floodStatus: "outside" as const, floodStatusReason: null, depthRank: 0 };
  return { floodStatus: "unknown" as const, floodStatusReason: pixel.reason, depthRank: null };
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "この機能は研究用であり、本番環境では無効化されています" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストの形式が不正です" }, { status: 400 });
  }

  const { results, provenance } = (body ?? {}) as { results?: RawResult[]; provenance?: Record<string, unknown> };
  if (!Array.isArray(results) || results.length === 0) {
    return NextResponse.json({ error: "results(配列, 1件以上)が必要です" }, { status: 400 });
  }

  const generatedAt = new Date().toISOString();
  const gitCommit = resolveGitCommit();
  const systemVersion = (packageJson as { version?: string }).version ?? "unknown";

  const classified = results.map((r) => {
    const { floodStatus, floodStatusReason, depthRank } = toFloodStatus(r.pixel, r.captureFailed);
    return { id: r.id, latitude: r.latitude, longitude: r.longitude, ward: r.ward, name: r.name, floodStatus, floodStatusReason, depthRank };
  });

  const hazardCount = classified.filter((c) => c.floodStatus === "hazard").length;
  const outsideCount = classified.filter((c) => c.floodStatus === "outside").length;
  const unknownCount = classified.filter((c) => c.floodStatus === "unknown").length;

  const reasonBreakdown: Record<string, number> = {};
  for (const c of classified) {
    if (c.floodStatus !== "unknown") continue;
    const key = c.floodStatusReason ?? "other";
    reasonBreakdown[key] = (reasonBreakdown[key] ?? 0) + 1;
  }

  const dataset = {
    metadata: {
      generatedAt,
      systemVersion,
      gitCommit,
      ruleVersion: RULE_VERSION,
      purpose:
        "本実験地点のhazard/outside層化無作為抽出のための、candidate population全数の機械分類。" +
        "この結果を見て個別に地点を選ぶものではなく、次段階のseed固定random samplingの入力にする(要件定義書3参照)。",
      ...provenance,
      candidateCount: classified.length,
      hazardCount,
      outsideCount,
      unknownCount,
      unknownRatio: classified.length > 0 ? unknownCount / classified.length : null,
      unknownReasonBreakdown: reasonBreakdown,
    },
    candidates: classified,
  };

  try {
    await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, JSON.stringify(dataset, null, 2), "utf-8");
  } catch (err) {
    return NextResponse.json(
      { error: "分類結果の書き込みに失敗しました", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    outputPath: "scripts/research-data/candidate-population-classification.json",
    summary: { candidateCount: classified.length, hazardCount, outsideCount, unknownCount, reasonBreakdown },
  });
}
