// Phase 5A.1 / 5A.2: サンプリング間隔比較実験
//
// 目的: 洪水ハザードのルート評価（lib/routeHazardEvaluation.ts）について、
// サンプリング間隔（20/30/50/100m）を変えたときに評価結果・処理時間が
// どう変化するかを、複数地点・複数ルートで記録する。
//
// 【Phase5A.2での変更】
// 以前はこのスクリプト内にサンプリング・集計ロジックを複製していたが、
// 本番コード（lib/routeHazardMath.ts）との乖離（Phase5A.1の距離計算バグ等）を
// 防ぐため、Node.jsのTypeScriptネイティブ実行機能を使って本番の関数を
// そのままimportして使用するように変更した。
// ブラウザ（Playwright）は、canvasでのタイル画像ピクセル読み取りという
// ブラウザ環境が必須な処理のみに限定して使用する。
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
// 出力: scripts/research-data/route-sampling-experiment-results.v2.json
//       scripts/research-data/route-sampling-experiment-results.v2.csv
// （Phase5A.1時点の結果は route-sampling-experiment-results.json / .csv に
//   残し、before/afterを比較できるようにしている）

import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sampleRouteAtInterval, aggregateRouteHazardResults } from "../lib/routeHazardMath.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "research-data");
mkdirSync(outDir, { recursive: true });

const APP_URL = "http://localhost:3000";
const INTERVALS = [20, 30, 50, 100];
const FLOOD_TILE_URL_TEMPLATE =
  "https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png";

// 性質の異なる5地点（大阪市内、実地移動不要・地図上の座標のみ）
// Phase5A.1と同一地点（before/after比較のため変更していない）
const TEST_LOCATIONS = [
  { id: "L1", label: "都心・河川近く（北区・堂島川周辺）", lat: 34.6937, lng: 135.5023 },
  { id: "L2", label: "湾岸低地（港区周辺）", lat: 34.6683, lng: 135.4429 },
  { id: "L3", label: "内陸・上町台地寄り（天王寺区周辺）", lat: 34.6519, lng: 135.5162 },
  { id: "L4", label: "東部低地（城東区周辺）", lat: 34.6969, lng: 135.5622 },
  { id: "L5", label: "南部（阿倍野区周辺）", lat: 34.6127, lng: 135.5138 },
];

// ブラウザ側で複数地点の洪水タイルピクセルをまとめて読み取る（canvasが必須なためブラウザ内で実行）。
// 【計測条件】本番コード（lib/routeHazardEvaluation.ts）はPromise.allで全地点を並列取得する。
// ここも同じくPromise.allで1回のpage.evaluate呼び出しにまとめており、
// 地点ごとにNode↔ブラウザ間の往復（CDPラウンドトリップ）が発生しないようにしている
// （地点ごとに別々にpage.evaluateすると、往復オーバーヘッドがアルゴリズムの処理時間に
// 混入し、本番の並列fetchの挙動と比較できなくなるため）。
async function assessFloodAtPointsInBrowser(page, points) {
  return page.evaluate(
    async ({ points, urlTemplate }) => {
      async function assessOne({ lat, lng }) {
        const zoom = 16;
        const n = 2 ** zoom;
        const latRad = (lat * Math.PI) / 180;
        const xTileFloat = ((lng + 180) / 360) * n;
        const yTileFloat = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
        const xTile = Math.floor(xTileFloat);
        const yTile = Math.floor(yTileFloat);
        const px = Math.min(255, Math.floor((xTileFloat - xTile) * 256));
        const py = Math.min(255, Math.floor((yTileFloat - yTile) * 256));
        const url = urlTemplate.replace("{z}", zoom).replace("{x}", xTile).replace("{y}", yTile);

        let res;
        try {
          res = await fetch(url);
        } catch {
          return { status: "unknown", reason: "fetch_error" };
        }
        if (res.status === 404) return { status: "unknown", reason: "no_tile" };
        if (!res.ok) return { status: "unknown", reason: "fetch_error" };

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

          const LEGEND = [
            { rgb: [247, 245, 169], rank: 1 },
            { rgb: [255, 216, 192], rank: 2 },
            { rgb: [255, 183, 183], rank: 3 },
            { rgb: [255, 145, 145], rank: 4 },
            { rgb: [242, 133, 201], rank: 5 },
            { rgb: [220, 122, 220], rank: 5 },
          ];
          let best = null,
            bestDist = Infinity;
          for (const e of LEGEND) {
            const d = Math.sqrt((data[0] - e.rgb[0]) ** 2 + (data[1] - e.rgb[1]) ** 2 + (data[2] - e.rgb[2]) ** 2);
            if (d < bestDist) {
              bestDist = d;
              best = e;
            }
          }
          if (best && bestDist <= 60) return { status: "evaluated", rank: best.rank };
          return { status: "unknown", reason: "unrecognized_color" };
        } catch {
          return { status: "unknown", reason: "fetch_error" };
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      }
      return Promise.all(points.map(assessOne));
    },
    { points, urlTemplate: FLOOD_TILE_URL_TEMPLATE }
  );
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(APP_URL, { waitUntil: "networkidle" });

  const allRows = [];

  for (const loc of TEST_LOCATIONS) {
    console.log(`\n=== ${loc.id}: ${loc.label} ===`);

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

    for (let routeIndex = 0; routeIndex < routesResult.routes.length; routeIndex++) {
      const route = routesResult.routes[routeIndex];
      const routeLabel = ["A", "B", "C"][routeIndex] ?? String(routeIndex + 1);

      for (const intervalMeters of INTERVALS) {
        const startedAt = Date.now();

        // サンプリングは本番と同じ関数をNode側で実行（純粋関数、ブラウザ不要）
        const samples = sampleRouteAtInterval(route.geometry, intervalMeters);

        // タイル読み取りは本番同様Promise.allで並列実行（1回のpage.evaluateにまとめる）
        const results = await assessFloodAtPointsInBrowser(page, samples.map((s) => s.point));

        // 集計も本番と同じ関数
        const agg = aggregateRouteHazardResults(samples, results);
        const processingTimeMs = Date.now() - startedAt;

        const evalResult = { sampleIntervalMeters: intervalMeters, sampleCount: samples.length, ...agg, processingTimeMs };

        allRows.push({
          testId: `${loc.id}-${routeLabel}-${intervalMeters}m`,
          locationId: loc.id,
          locationLabel: loc.label,
          destinationName: candidate.name,
          route: routeLabel,
          intervalMeters,
          routingDistanceMeters: route.distanceMeters,
          routeDurationSeconds: route.durationSeconds,
          ...evalResult,
        });

        console.log(
          `    ${routeLabel} @ ${intervalMeters}m: sample=${evalResult.sampleCount}, ` +
            `hazardEvalDist=${evalResult.hazardEvaluationDistanceMeters.toFixed(0)}m, ` +
            `flood=${evalResult.floodCrossingDistanceMeters.toFixed(0)}m ` +
            `(${evalResult.floodCrossingRatioAmongEvaluatedDistance !== null ? (evalResult.floodCrossingRatioAmongEvaluatedDistance * 100).toFixed(1) + "%" : "N/A"}), ` +
            `maxRank=${evalResult.maxDepthRank}, coverage=${evalResult.evaluationCoverageRatio !== null ? (evalResult.evaluationCoverageRatio * 100).toFixed(1) + "%" : "N/A"}, ` +
            `time=${evalResult.processingTimeMs}ms`
        );
      }
    }
  }

  await browser.close();

  const jsonPath = path.join(outDir, "route-sampling-experiment-results.v2.json");
  writeFileSync(jsonPath, JSON.stringify(allRows, null, 2), "utf-8");

  const columns = [
    "testId",
    "locationId",
    "locationLabel",
    "destinationName",
    "route",
    "intervalMeters",
    "routingDistanceMeters",
    "routeDurationSeconds",
    "sampleCount",
    "hazardEvaluationDistanceMeters",
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
  for (const row of allRows) csvLines.push(columns.map((c) => row[c]).join(","));
  const csvPath = path.join(outDir, "route-sampling-experiment-results.v2.csv");
  writeFileSync(csvPath, csvLines.join("\n"), "utf-8");

  console.log(`\n完了: ${allRows.length}件の結果を書き出しました。`);
  console.log(`  ${jsonPath}`);
  console.log(`  ${csvPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
