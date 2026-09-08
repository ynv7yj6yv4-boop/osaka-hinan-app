// 要件定義書3 docs/research-location-sampling-design.md §8: 本実験のcandidate population
// （既存の洪水対応指定緊急避難場所データ）を、クライアント側の判定ページへ渡すエンドポイント。
//
// 【重要】研究専用ツールであり、本番環境では無効化する。
// このファイル自体は避難場所データを一切変更しない(読み取り専用)。

import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const SHELTERS_PATH = path.join(process.cwd(), "public", "data", "osaka-shelters.json");

// lib/floodShelterCandidates.tsと同じ絞り込み条件(type===evacuation_site かつ hazards に flood)。
type ShelterFeature = {
  id: string;
  type: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  hazards: string[];
};

// 大阪市の住所表記("大阪府大阪市○○区...")から区名を抽出する。
// 【重要】"大阪市"と別の市名(例:吹田市)が同一住所内に混在する等、抽出できない/
// 矛盾するレコードは候補から除外し、除外ログへ理由付きで残す(design doc §13)。
const WARD_PATTERN = /^大阪府大阪市(\S+?区)/;

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "この機能は研究用であり、本番環境では無効化されています" }, { status: 403 });
  }

  let raw: string;
  try {
    raw = await readFile(SHELTERS_PATH, "utf-8");
  } catch {
    return NextResponse.json({ error: "避難場所データを読み込めませんでした" }, { status: 404 });
  }

  const data = JSON.parse(raw) as {
    source: string;
    sourceUrl: string;
    fetchedAt: string;
    features: ShelterFeature[];
  };

  const fileHash = createHash("sha256").update(raw).digest("hex");

  const floodCapable = data.features.filter(
    (f) => f.type === "evacuation_site" && Array.isArray(f.hazards) && f.hazards.includes("flood")
  );

  const candidates: { id: string; latitude: number; longitude: number; ward: string; name: string }[] = [];
  const excluded: { id: string; name: string; address: string; reason: string }[] = [];

  for (const f of floodCapable) {
    const match = f.address.match(WARD_PATTERN);
    if (!match) {
      excluded.push({
        id: f.id,
        name: f.name,
        address: f.address,
        reason: "ward_extraction_failed_or_ambiguous_municipality",
      });
      continue;
    }
    candidates.push({ id: f.id, latitude: f.lat, longitude: f.lng, ward: match[1], name: f.name });
  }

  return NextResponse.json({
    provenance: {
      sourceDataset: data.source,
      sourceUrl: data.sourceUrl,
      sourcePublicationDate: data.fetchedAt,
      originalFilename: "public/data/osaka-shelters.json",
      fileHash,
      totalFeatures: data.features.length,
      floodCapableEvacuationSiteCount: floodCapable.length,
      candidatePopulationCount: candidates.length,
      excludedCount: excluded.length,
      filterCondition: 'type === "evacuation_site" && hazards.includes("flood")',
    },
    candidates,
    excluded,
  });
}
