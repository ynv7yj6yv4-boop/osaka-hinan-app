// 試作3 要件定義書3 §71〜73 PART C: staticFloodHazard方式Bの研究地点入力を
// 開発用ページ(app/dev/static-flood-hazard-capture)へ渡すためのエンドポイント。
//
// 【重要】研究専用ツールであり、本番環境(NODE_ENV=production)では無効化する
// (DevNotificationTester等と同じ方針。app/layout.tsxのNEXT_PUBLIC_ENABLE_DEV_TOOLS参照)。
// GETのみ・読み取り専用(このファイルへの書き込みは行わない。人間が事前に用意する)。

import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

const POINTS_FILE_PATH = path.join(process.cwd(), "scripts", "research-data", "research-monitoring-points.json");

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "この機能は研究用であり、本番環境では無効化されています" }, { status: 403 });
  }

  try {
    const raw = await readFile(POINTS_FILE_PATH, "utf-8");
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json(
      {
        error:
          "研究地点入力ファイルを読み込めませんでした: " +
          "scripts/research-data/research-monitoring-points.json",
      },
      { status: 404 }
    );
  }
}
