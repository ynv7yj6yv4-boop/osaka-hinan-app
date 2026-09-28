// 地域判定基盤（Phase 2）: 緯度経度から都道府県・市区町村を判定する、
// フレームワーク非依存の純粋ロジック。
//
// 【重要・最重要方針】単純な矩形（バウンディングボックス）判定は、
// 府県境付近で誤判定するため使用しない。実際の行政区域ポリゴンに対する
// Point in Polygonで判定する（データの出典・生成方法は
// scripts/build-region-boundaries.mjs参照、国土数値情報N03が元データ）。
//
// 【重要・境界のあいまいさへの対応】簡略化したポリゴンには数十〜数百m
// 程度の誤差がありうるため、市区町村ポリゴンに完全一致しただけで
// 「確実にこの県」と断定しない。都道府県単位でバッファした別レイヤー
// (kinki-prefectures-buffered.geojson。バッファ距離は
// regionBoundaryConfig.tsのREGION_BOUNDARY_AMBIGUITY_BUFFER_METERSで
// 一元管理し、scripts/build-region-boundaries.mjsがそれを使って生成する)
// を使い、そのバッファ内に複数の都道府県が同時にヒットする地点は、
// 府県境付近のあいまいな地点とみなし"unknown"を返す
// （判定不能を「近畿外」と誤認しないため）。

import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";
import type { Feature, FeatureCollection, Polygon, MultiPolygon } from "geojson";
import type { PrefectureCode, Region, RegionCheckResult } from "./types.ts";
import { PREFECTURE_NAMES } from "./types.ts";

type MunicipalityProperties = {
  prefectureCode: PrefectureCode;
  prefectureName: string;
  municipalityCode: string;
  municipalityName: string;
};

type PrefectureBufferProperties = {
  prefectureCode: PrefectureCode;
  prefectureName: string;
};

export type RegionBoundaryData = {
  municipalities: FeatureCollection<Polygon | MultiPolygon, MunicipalityProperties>;
  bufferedPrefectures: FeatureCollection<Polygon | MultiPolygon, PrefectureBufferProperties>;
};

function isValidPrefectureCode(code: string): code is PrefectureCode {
  return code in PREFECTURE_NAMES;
}

/**
 * 境界データ（呼び出し側で読み込み済みのもの）を使って、緯度経度から
 * 地域を判定する。純粋関数（ファイルI/O・ネットワークを含まない）のため、
 * サーバー側API route・テストの両方から同じロジックを使い回せる。
 */
export function lookupRegion(lat: number, lng: number, boundaries: RegionBoundaryData): RegionCheckResult {
  const pt = point([lng, lat]);

  // まず都道府県バッファ層で「近畿2府4県のいずれかに近い場所か」を確認する。
  const bufferedMatches = boundaries.bufferedPrefectures.features.filter((f) =>
    booleanPointInPolygon(pt, f as Feature<Polygon | MultiPolygon>)
  );

  if (bufferedMatches.length === 0) {
    // どの都道府県のバッファにも入らない＝近畿2府4県から明確に離れている。
    return { status: "outside" };
  }

  if (bufferedMatches.length >= 2) {
    // 複数の都道府県のバッファに同時に入る＝府県境付近で確信が持てない。
    return { status: "unknown" };
  }

  // ここまでで「ちょうど1つの都道府県バッファにのみ入る」ことが確定している。
  // 続けて市区町村ポリゴンの完全一致を試み、分かれば市区町村名まで返す。
  const municipalityMatch = boundaries.municipalities.features.find((f) =>
    booleanPointInPolygon(pt, f as Feature<Polygon | MultiPolygon>)
  );

  const bufferedPrefCode = bufferedMatches[0].properties.prefectureCode;
  if (!isValidPrefectureCode(bufferedPrefCode)) {
    return { status: "error", message: `不正な都道府県コードです: ${bufferedPrefCode}` };
  }

  if (municipalityMatch) {
    const p = municipalityMatch.properties;
    const region: Region = {
      prefectureCode: p.prefectureCode,
      prefectureName: p.prefectureName,
      municipalityCode: p.municipalityCode,
      municipalityName: p.municipalityName,
    };
    return { status: "supported", region };
  }

  // バッファ層では1件だけヒットしたが、市区町村ポリゴン（バッファなし・
  // より厳密な形状）には一致しなかった場合（例: 簡略化誤差で海岸線の
  // すぐ外側に落ちた等）。都道府県までは分かっているとみなして返す
  // （市区町村は未解決のまま、推測で埋めない）。
  const region: Region = {
    prefectureCode: bufferedPrefCode,
    prefectureName: PREFECTURE_NAMES[bufferedPrefCode],
  };
  return { status: "supported", region };
}
