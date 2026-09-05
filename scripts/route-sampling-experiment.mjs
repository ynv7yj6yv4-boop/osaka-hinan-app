// Phase 5A.1: サンプリング間隔比較実験
//
// 目的: 洪水ハザードのルート評価（lib/routeHazardEvaluation.ts）について、
// サンプリング間隔（20/30/50/100m）を変えたときに評価結果・処理時間が
// どう変化するかを、複数地点・複数ルートで記録する。
//
// 【重要】この結果から「何mが最適か」を自動的に結論づけることはしない。
// 記録した表を人間（研究者）が確認し、最終的な採用間隔を判断するための
// 資料を作ることが目的。
//
// 実行方法:
//   1. 別ターミナルで `npm run dev` を起動しておく（.env.local に
//      OPENROUTESERVICE_API_KEY が設定されていること）
//   2. `node scripts/route-sampling-experiment.mjs`
//
// 出力: scripts/research-data/route-sampling-experiment-results.json
//       scripts/research-data/route-sampling-experiment-results.csv

import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "research-data");
mkdirSync(outDir, { recursive: true });

const APP_URL = "http://localhost:3000";
const INTERVALS = [20, 30, 50, 100];

// 性質の異なる5地点（大阪市内、実地移動不要・地図上の座標のみ）
const TEST_LOCATIONS = [
  { id: "L1", label: "都心・河川近く（北区・堂島川周辺）", lat: 34.6937, lng: 135.5023 },
  { id: "L2", label: "湾岸低地（港区周辺）", lat: 34.6683, lng: 135.4429 },
  { id: "L3", label: "内陸・上町台地寄り（天王寺区周辺）", lat: 34.6519, lng: 135.5162 },
  { id: "L4", label: "東部低地（城東区周辺）", lat: 34.6969, lng: 135.5622 },
  { id: "L5", label: "南部（阿倍野区周辺）", lat: 34.6127, lng: 135.5138 },
];

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(APP_URL, { waitUntil: "networkidle" });

  const allRows = [];

  for (const loc of TEST_LOCATIONS) {
    console.log(`\n=== ${loc.id}: ${loc.label} ===`);

    // 1) 洪水対応の最寄り候補を1件取得
    const candidate = await page.evaluate(async ({ lat, lng }) => {
      const res = await fetch("/data/osaka-shelters.json");
      const data = await res.json();
      const R = 6371000;
      const toRad = (d) => (d * Math.PI) / 180;
      const dist = (a, b) => {
        const dLat = toRad(b.lat - a.lat);
        const dLng = toRad(b.lng - a.lng);
        const h =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
      };
      const floodSites = data.features.filter(
        (f) => f.type === "evacuation_site" && f.hazards.includes("flood")
      );
      floodSites.sort((a, b) => dist({ lat, lng }, a) - dist({ lat, lng }, b));
      const nearest = floodSites[0];
      return nearest
        ? { id: nearest.id, name: nearest.name, lat: nearest.lat, lng: nearest.lng }
        : null;
    }, loc);

    if (!candidate) {
      console.log("  候補が見つかりませんでした。スキップします。");
      continue;
    }
    console.log(`  避難先候補: ${candidate.name}`);

    // 2) openrouteserviceでルート取得（自前APIルート経由、キーはブラウザに出さない）
    const routesResult = await page.evaluate(
      async ({ origin, destination }) => {
        const res = await fetch("/api/evacuation-route", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ origin, destination }),
        });
        const data = await res.json();
        if (!res.ok) return { error: data.error ?? "unknown error" };
        const features = data.geojson?.features ?? [];
        return {
          routes: features.map((f) => ({
            distanceMeters: f.properties?.summary?.distance ?? 0,
            durationSeconds: f.properties?.summary?.duration ?? 0,
            geometry: (f.geometry?.coordinates ?? []).map(([lng, lat]) => ({ lat, lng })),
          })),
        };
      },
      { origin: { lat: loc.lat, lng: loc.lng }, destination: candidate }
    );

    if (routesResult.error) {
      console.log(`  ルート取得エラー: ${routesResult.error}`);
      continue;
    }

    console.log(`  取得ルート数: ${routesResult.routes.length}`);

    // 3) 各ルート × 各間隔でハザード評価（ブラウザ内でPhase3と同じ手法を再現）
    for (let routeIndex = 0; routeIndex < routesResult.routes.length; routeIndex++) {
      const route = routesResult.routes[routeIndex];
      const routeLabel = ["A", "B", "C"][routeIndex] ?? String(routeIndex + 1);

      for (const intervalMeters of INTERVALS) {
        const evalResult = await page.evaluate(
          async ({ geometry, intervalMeters, floodTileUrlTemplate }) => {
            const R = 6371000;
            const toRad = (d) => (d * Math.PI) / 180;
            function haversine(a, b) {
              const dLat = toRad(b.lat - a.lat);
              const dLng = toRad(b.lng - a.lng);
              const h =
                Math.sin(dLat / 2) ** 2 +
                Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
              return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
            }
            function interpolate(a, b, t) {
              return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
            }
            function sampleAtInterval(geom, interval) {
              if (geom.length === 0) return [];
              if (geom.length === 1) return [geom[0]];
              const points = [geom[0]];
              let distSince = 0;
              for (let i = 0; i < geom.length - 1; i++) {
                const segStart = geom[i];
                const segEnd = geom[i + 1];
                const segLen = haversine(segStart, segEnd);
                if (segLen === 0) continue;
                let covered = 0;
                while (distSince + (segLen - covered) >= interval) {
                  const remaining = interval - distSince;
                  covered += remaining;
                  const t = covered / segLen;
                  points.push(interpolate(segStart, segEnd, Math.min(1, t)));
                  distSince = 0;
                }
                distSince += segLen - covered;
              }
              const last = geom[geom.length - 1];
              const lastSampled = points[points.length - 1];
              if (haversine(lastSampled, last) > 1) points.push(last);
              return points;
            }

            // Phase3のhazardColorLegend.tsと同じ凡例（国交省資料+実タイル照合済み）
            const LEGEND = [
              { rgb: [247, 245, 169], rank: 1 },
              { rgb: [255, 216, 192], rank: 2 },
              { rgb: [255, 183, 183], rank: 3 },
              { rgb: [255, 145, 145], rank: 4 },
              { rgb: [242, 133, 201], rank: 5 },
              { rgb: [220, 122, 220], rank: 5 },
            ];
            function matchColor(r, g, b) {
              let best = null,
                bestDist = Infinity;
              for (const e of LEGEND) {
                const d = Math.sqrt((r - e.rgb[0]) ** 2 + (g - e.rgb[1]) ** 2 + (b - e.rgb[2]) ** 2);
                if (d < bestDist) {
                  bestDist = d;
                  best = e;
                }
              }
              return best && bestDist <= 60 ? best.rank : null;
            }

            function lngLatToTilePixel(lat, lng, zoom) {
              const n = 2 ** zoom;
              const latRad = (lat * Math.PI) / 180;
              const xTileFloat = ((lng + 180) / 360) * n;
              const yTileFloat =
                ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
              const xTile = Math.floor(xTileFloat);
              const yTile = Math.floor(yTileFloat);
              const px = Math.min(255, Math.floor((xTileFloat - xTile) * 256));
              const py = Math.min(255, Math.floor((yTileFloat - yTile) * 256));
              return { xTile, yTile, px, py };
            }

            async function assessFlood(point) {
              const zoom = 16;
              const { xTile, yTile, px, py } = lngLatToTilePixel(point.lat, point.lng, zoom);
              const url = floodTileUrlTemplate
                .replace("{z}", zoom)
                .replace("{x}", xTile)
                .replace("{y}", yTile);
              let res;
              try {
                res = await fetch(url);
              } catch {
                return { status: "unavailable" };
              }
              if (!res.ok) return { status: "unavailable" };
              const blob = await res.blob();
              const objectUrl = URL.createObjectURL(blob);
              try {
                const img = await new Promise((resolve, reject) => {
                  const im = new Image();
                  im.onload = () => resolve(im);
                  im.onerror = reject;
                  im.src = objectUrl;
                });
                const canvas = document.createElement("canvas");
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0);
                const data = ctx.getImageData(px, py, 1, 1).data;
                if (data[3] === 0) return { status: "evaluated", rank: 0 };
                const rank = matchColor(data[0], data[1], data[2]);
                return rank === null ? { status: "unavailable" } : { status: "evaluated", rank };
              } catch {
                return { status: "unavailable" };
              } finally {
                URL.revokeObjectURL(objectUrl);
              }
            }

            const startedAt = performance.now();
            const samplePoints = sampleAtInterval(geometry, intervalMeters);
            const results = await Promise.all(samplePoints.map(assessFlood));

            let evaluatedDistance = 0;
            let hazardDistance = 0;
            let unavailableDistance = 0;
            let unavailableCount = 0;
            let maxRank = 0;

            for (let i = 0; i < samplePoints.length - 1; i++) {
              const segLength = haversine(samplePoints[i], samplePoints[i + 1]);
              const a = results[i];
              const b = results[i + 1];
              if (a.status === "unavailable" || b.status === "unavailable") {
                unavailableDistance += segLength;
                continue;
              }
              evaluatedDistance += segLength;
              const segMaxRank = Math.max(a.rank, b.rank);
              if (segMaxRank > 0) hazardDistance += segLength;
              maxRank = Math.max(maxRank, segMaxRank);
            }
            for (const r of results) if (r.status === "unavailable") unavailableCount++;

            const routeTotalDistance = evaluatedDistance + unavailableDistance;
            const processingTimeMs = performance.now() - startedAt;

            return {
              sampleIntervalMeters: intervalMeters,
              sampleCount: samplePoints.length,
              routeTotalDistanceMeters: routeTotalDistance,
              evaluatedDistanceMeters: evaluatedDistance,
              unavailableDistanceMeters: unavailableDistance,
              evaluationCoverageRatio: routeTotalDistance > 0 ? evaluatedDistance / routeTotalDistance : null,
              floodCrossingDistanceMeters: hazardDistance,
              floodCrossingRatioAmongEvaluatedDistance:
                evaluatedDistance > 0 ? hazardDistance / evaluatedDistance : null,
              unavailableSampleCount: unavailableCount,
              maxDepthRank: maxRank,
              processingTimeMs,
            };
          },
          {
            geometry: route.geometry,
            intervalMeters,
            floodTileUrlTemplate:
              "https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png",
          }
        );

        allRows.push({
          testId: `${loc.id}-${routeLabel}-${intervalMeters}m`,
          locationId: loc.id,
          locationLabel: loc.label,
          destinationName: candidate.name,
          route: routeLabel,
          intervalMeters,
          routeDistanceMeters: route.distanceMeters,
          routeDurationSeconds: route.durationSeconds,
          ...evalResult,
        });

        console.log(
          `    ${routeLabel} @ ${intervalMeters}m: sample=${evalResult.sampleCount}, ` +
            `flood=${evalResult.floodCrossingDistanceMeters.toFixed(0)}m ` +
            `(${evalResult.floodCrossingRatioAmongEvaluatedDistance !== null ? (evalResult.floodCrossingRatioAmongEvaluatedDistance * 100).toFixed(1) + "%" : "N/A"}), ` +
            `maxRank=${evalResult.maxDepthRank}, coverage=${evalResult.evaluationCoverageRatio !== null ? (evalResult.evaluationCoverageRatio * 100).toFixed(1) + "%" : "N/A"}, ` +
            `time=${evalResult.processingTimeMs.toFixed(0)}ms`
        );
      }
    }
  }

  await browser.close();

  // JSON出力
  const jsonPath = path.join(outDir, "route-sampling-experiment-results.json");
  writeFileSync(jsonPath, JSON.stringify(allRows, null, 2), "utf-8");

  // CSV出力
  const columns = [
    "testId",
    "locationId",
    "locationLabel",
    "destinationName",
    "route",
    "intervalMeters",
    "routeDistanceMeters",
    "routeDurationSeconds",
    "sampleCount",
    "routeTotalDistanceMeters",
    "evaluatedDistanceMeters",
    "unavailableDistanceMeters",
    "evaluationCoverageRatio",
    "floodCrossingDistanceMeters",
    "floodCrossingRatioAmongEvaluatedDistance",
    "unavailableSampleCount",
    "maxDepthRank",
    "processingTimeMs",
  ];
  const csvLines = [columns.join(",")];
  for (const row of allRows) {
    csvLines.push(columns.map((c) => row[c]).join(","));
  }
  const csvPath = path.join(outDir, "route-sampling-experiment-results.csv");
  writeFileSync(csvPath, csvLines.join("\n"), "utf-8");

  console.log(`\n完了: ${allRows.length}件の結果を書き出しました。`);
  console.log(`  ${jsonPath}`);
  console.log(`  ${csvPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
