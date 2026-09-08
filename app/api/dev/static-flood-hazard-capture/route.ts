// 試作3 要件定義書3 §71〜73 PART E〜K: staticFloodHazard方式B
// 「既存ブラウザ判定 → 研究用固定JSON」の保存エンドポイント。
//
// 【方式Bの分担】
// - タイル取得・ピクセル判定(classifyHazardPixel)はブラウザのCanvas APIに
//   依存するため、ここ(サーバー側)では行わない。判定は必ず
//   app/dev/static-flood-hazard-capture/page.tsx(クライアント側)が
//   既存のlib/hazardPixelClassifier.tsを直接呼び出して行う。
// - ここ(サーバー側)は、ブラウザから届いた判定結果に
//   provenance(gitCommit・systemVersion等)を付与し、
//   scripts/research-data/static-flood-hazard-points.json として固定するだけ。
// 新しい洪水判定アルゴリズムはここでも作成していない(PART A)。
//
// 【重要】研究専用ツールであり、本番環境では無効化する。

import { NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import { HAZARD_TILE_URL } from "@/components/hazardLayers";
import {
  toStaticFloodHazardPointResult,
  toCaptureFailurePointResult,
  buildStaticFloodHazardDataset,
  type FloodStatusReason,
} from "@/lib/staticFloodHazardCapture";
import type { HazardPixelStatus } from "@/lib/hazardPixelClassifier";
import packageJson from "../../../../package.json";

const OUTPUT_PATH = path.join(process.cwd(), "scripts", "research-data", "static-flood-hazard-points.json");

type RawCaptureResult = {
  pointId: string;
  latitude: number;
  longitude: number;
  pixel?: HazardPixelStatus;
  captureFailed?: boolean;
  failureReason?: FloodStatusReason;
};

function resolveGitCommit(): string {
  try {
    return execSync("git rev-parse HEAD", { cwd: process.cwd() }).toString().trim();
  } catch {
    // 【重要】gitコマンドが使えない環境でも処理を止めない。
    // ただし推測はせず、取得できなかったことが分かる値にする(要件定義書3 §29等の方針に合わせる)。
    return "unknown";
  }
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

  const { points } = (body ?? {}) as { points?: unknown };
  if (!Array.isArray(points) || points.length === 0) {
    return NextResponse.json({ error: "points(配列, 1件以上)が必要です" }, { status: 400 });
  }

  const evaluatedAt = new Date().toISOString();
  const gitCommit = resolveGitCommit();
  const systemVersion = (packageJson as { version?: string }).version ?? "unknown";
  const meta = { evaluatedAt, systemVersion, gitCommit };

  // PART G: 取得に失敗した地点も黙って除外せず、必ず1件のレコードを残す。
  const results = (points as RawCaptureResult[]).map((raw) => {
    const pointRef = { pointId: raw.pointId, latitude: raw.latitude, longitude: raw.longitude };
    if (raw.captureFailed || !raw.pixel) {
      return toCaptureFailurePointResult(pointRef, meta, raw.failureReason ?? "browser_error");
    }
    return toStaticFloodHazardPointResult(pointRef, raw.pixel, meta);
  });

  const dataset = buildStaticFloodHazardDataset(results, {
    generatedAt: evaluatedAt,
    systemVersion,
    gitCommit,
    sourceURLPattern: HAZARD_TILE_URL.flood,
  });

  try {
    await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, JSON.stringify(dataset, null, 2), "utf-8");
  } catch (err) {
    return NextResponse.json(
      { error: "固定JSONの書き込みに失敗しました", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, outputPath: "scripts/research-data/static-flood-hazard-points.json", dataset });
}
