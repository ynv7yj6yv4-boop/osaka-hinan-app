// Phase 6 PART A: 明確な重複避難所の保守的な名寄せ。
//
// 【設計方針・安全側】誤って別施設を統合することを避けるため、自動統合の
// 条件は非常に保守的にする。「同じ名前で120m以内」だけを理由にした自動
// 統合は行わない（A棟・B棟・C棟のような近接別施設を誤統合するおそれが
// あるため）。自動統合するのは、以下をすべて満たす場合のみ:
//   1. 同一municipalityCode
//   2. 同一shelterType（指定緊急避難場所どうし／指定避難所どうしのみ。
//      指定緊急避難場所と指定避難所の統合＝"both"化は今回も行わない）
//   3. 正規化後の施設名が完全一致（正規化は空白の表記ゆれのみ。
//      「小学校」と「○○小」のような意味推測を伴う変換は一切行わない）
//   4. 座標間の距離がEXACT_DUPLICATE_DISTANCE_METERS以下
//      （＝実質的に同一座標。GPS取得・丸め誤差の許容分のみ）
//   5. supportedDisasters.flood と hazards（対応災害種別の集合）が完全一致
//      （矛盾がある場合は「同一施設の可能性はあるが、データが食い違って
//      いる」状態であり、安全側に倒して自動統合しない）
// これらを満たさない近接同名レコードは統合せず、そのまま個別レコードとして
// 残す（＝候補一覧に別々に表示されうる）。将来、近畿全域データが出揃った
// 後の本格的な名寄せルール検討のため、flaggedペアとして報告できるように
// 呼び出し側へ返す。
//
// 【実行タイミング】scripts/build-shelters.mjsのJSON生成段階（ビルド時）で
// 実行し、ブラウザ側（Provider・UI）では重複判定を行わない。

import type { Shelter } from "./types.ts";

/** 実質的に同一座標とみなす距離のしきい値（メートル）。GPS取得・座標の
 *  丸め誤差の許容分のみを想定した小さな値。この値を超える近接同名施設は
 *  自動統合せず、flaggedPairsとして報告する（例: A棟/B棟等の別施設の
 *  可能性があるため）。 */
export const EXACT_DUPLICATE_DISTANCE_METERS = 5;

/** flaggedPairsに含める「近接同名だが自動統合しなかった」候補を検出する際の
 *  上限距離（メートル）。これより遠い同名施設は無関係な別施設である可能性が
 *  高いため、報告対象にも含めない（Phase 3〜5で使っていた120m基準を踏襲）。 */
const NEARBY_SAME_NAME_REPORT_DISTANCE_METERS = 120;

export type FlaggedDuplicatePair = {
  name: string;
  municipalityCode: string;
  shelterType: Shelter["shelterType"];
  id1: string;
  id2: string;
  distanceMeters: number;
  reason: "distance_exceeded" | "hazard_mismatch";
};

export type DeduplicateResult = {
  shelters: Shelter[];
  /** 自動統合によって削除された（統合先に吸収された）レコード数。 */
  mergedRecordCount: number;
  /** 自動統合の対象になったクラスタ数（統合後に1件になった元レコード群の数）。 */
  mergedClusterCount: number;
  /** 名称・自治体・種別は一致するが、距離超過またはハザード情報の矛盾により
   *  自動統合しなかったペア（研究上の「要確認」記録用）。 */
  flaggedPairs: FlaggedDuplicatePair[];
};

// 比較用の名称正規化（表示名は変更しない）。Unicode互換正規化（NFKC:
// 全角英数字「６」→「6」、半角カナ「ｶ」→「カ」等の文字幅の違いのみ）と、
// 全角/半角スペース・連続スペース・前後空白の正規化だけを行う
// （「小学校」→「○○小」のような意味を推測する変換は行わない）。
export function normalizeNameForDedup(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/　/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 地球を球体とみなした簡易距離計算（Haversine公式）。
// lib/floodShelterCandidates.tsのhaversineDistanceMetersと同じ式だが、
// ビルドスクリプト（Node）側からも独立して使えるようここに複製する
// （ブラウザ専用コードに依存させないため）。
function haversineDistanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// supportedDisasters.flood と hazards（対応災害種別の集合）が完全一致するか。
// 順序に依存しないよう、hazardsはソートしてから比較する。
function hasSameHazardProfile(a: Shelter, b: Shelter): boolean {
  if (a.supportedDisasters.flood !== b.supportedDisasters.flood) return false;
  const ah = [...a.hazards].sort().join(",");
  const bh = [...b.hazards].sort().join(",");
  return ah === bh;
}

/**
 * 保守的な重複名寄せを行う。municipalityCode・shelterType・正規化後の
 * 施設名でグループ化し、グループ内でペアごとに自動統合の可否を判定する。
 * 【重要】3件以上の同名グループでも、各ペアが自動統合条件を満たす場合のみ
 * 連鎖的に1クラスタへ統合する（例: A-B統合可・B-C統合可ならA-B-Cを1件に。
 * A-Bのみ統合可でCが条件を満たさなければ、Cは独立レコードとして残す）。
 */
export function deduplicateShelters(shelters: Shelter[]): DeduplicateResult {
  const groups = new Map<string, Shelter[]>();
  for (const s of shelters) {
    const key = `${s.municipalityCode}|${s.shelterType}|${normalizeNameForDedup(s.name)}`;
    const group = groups.get(key);
    if (group) group.push(s);
    else groups.set(key, [s]);
  }

  const result: Shelter[] = [];
  const flaggedPairs: FlaggedDuplicatePair[] = [];
  let mergedRecordCount = 0;
  let mergedClusterCount = 0;

  for (const group of groups.values()) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }

    // Union-Find相当の簡易実装（グループ件数は実データ上ごく少数のため、
    // 単純なペアワイズ判定＋クラスタ併合で十分）。
    const parent = group.map((_, i) => i);
    function find(i: number): number {
      while (parent[i] !== i) i = parent[i];
      return i;
    }
    function union(i: number, j: number) {
      const ri = find(i);
      const rj = find(j);
      if (ri !== rj) parent[ri] = rj;
    }

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const distanceMeters = haversineDistanceMeters(group[i], group[j]);
        const withinExactDistance = distanceMeters <= EXACT_DUPLICATE_DISTANCE_METERS;
        const sameHazards = hasSameHazardProfile(group[i], group[j]);

        if (withinExactDistance && sameHazards) {
          union(i, j);
        } else if (distanceMeters <= NEARBY_SAME_NAME_REPORT_DISTANCE_METERS) {
          flaggedPairs.push({
            name: group[i].name,
            municipalityCode: group[i].municipalityCode,
            shelterType: group[i].shelterType,
            id1: group[i].id,
            id2: group[j].id,
            distanceMeters,
            reason: !withinExactDistance ? "distance_exceeded" : "hazard_mismatch",
          });
        }
      }
    }

    const clusters = new Map<number, Shelter[]>();
    for (let i = 0; i < group.length; i++) {
      const root = find(i);
      const cluster = clusters.get(root);
      if (cluster) cluster.push(group[i]);
      else clusters.set(root, [group[i]]);
    }

    for (const cluster of clusters.values()) {
      if (cluster.length === 1) {
        result.push(cluster[0]);
        continue;
      }
      const [primary, ...rest] = cluster;
      result.push({ ...primary, mergedFrom: cluster.map((c) => c.id) });
      mergedRecordCount += rest.length;
      mergedClusterCount += 1;
    }
  }

  return { shelters: result, mergedRecordCount, mergedClusterCount, flaggedPairs };
}
