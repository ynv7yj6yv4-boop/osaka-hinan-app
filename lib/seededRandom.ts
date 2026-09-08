// 要件定義書3 docs/research-location-sampling-design.md §10・11:
// 本実験地点の層化無作為抽出で使う、決定論的な擬似乱数生成器。
//
// 【重要】外部ライブラリへ依存せず、同じseed・同じ入力配列であれば
// 常に同じ結果を再現できることだけを目的とした最小実装。
// 暗号学的な強度は不要（研究再現性のための決定論性のみが目的）。

/**
 * mulberry32アルゴリズム。32bit符号なし整数のseedから、[0, 1)の疑似乱数列を生成する。
 * 参考実装は公知のアルゴリズムであり、本プロジェクト固有の判定ロジックとは無関係。
 */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return function random() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yatesシャッフル。渡した乱数生成器(random)の呼び出し順序だけに依存するため、
 * 同じseedのrandomを渡せば常に同じ並び順を再現する。元配列は変更しない。
 */
export function seededShuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
