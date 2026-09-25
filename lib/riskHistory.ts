// UI刷新の続き: 「前回確認したリスクと比べてどう変化したか」をこの端末内だけで
// 分かるようにするための、localStorage専用の小さなユーティリティ。
//
// 【重要・設計方針】
// - サーバー(Firestore)へは一切送信しない。ここで保存するのは
//   {level, evaluatedAt} のみで、latitude/longitude等の位置情報や
//   GPS履歴は保存しない(研究用プロトタイプとして、端末内にも不要な
//   位置履歴を増やさない方針)。
// - notificationLogs(自動監視・通知判定の履歴、Firestore)とは目的が異なる
//   別データのため、データ構造を統合しない。ここはあくまで
//   「ユーザーが画面でリスクを確認した履歴」。
// - localStorageが使えない環境(プライベートブラウズ・クォータ超過等)でも
//   災害リスク表示そのものは壊れないよう、失敗時は安全側(比較データなし)に倒す。
//
// 【純粋関数とI/Oの分離】compareRiskLevels()・formatPreviousCheckedAt()は
// localStorageに一切触れない純粋関数(Node testで直接検証できる)。
// localStorageへの実際の読み書きはrecordRiskHistoryEntry()にのみ閉じ込めている。

import type { RiskLevel } from "./riskAssessment.ts";

export type RiskHistoryEntry = {
  level: RiskLevel;
  /** ISO 8601文字列(RiskResult.generatedAtをそのまま使う想定)。 */
  evaluatedAt: string;
};

// 【重要】将来、保存形式を変更する可能性があるため、キーにバージョンを含める。
const STORAGE_KEY = "disaster-support:risk-history:v1";

// 履歴を無制限に増やさない。将来「safe→caution→prepare」等の簡易な時系列表示に
// 拡張する場合でも、直近10件程度あれば十分という想定。
export const MAX_HISTORY_ENTRIES = 10;

// unknownは「数値的なリスクレベル」として扱わない(safeより低い/prepareより高い、
// のような順序比較を一切行わない)。安全側のレベルのみ順序を持つ。
const RISK_ORDER: Record<Exclude<RiskLevel, "unknown">, number> = {
  safe: 0,
  caution: 1,
  prepare: 2,
  // evacuateは現状の判定ロジックでは到達しない(lib/riskAssessment.ts参照)が、
  // RiskLevel型に含まれる値のため、将来到達した場合に備えて最高位に位置づけておく。
  evacuate: 3,
};

export type RiskComparison =
  | { kind: "no_previous" } // 初回、比較対象がまだ無い
  | { kind: "both_unknown" } // 前回・今回ともunknown
  | { kind: "unknown_now" } // 前回は比較可能だったが、今回unknown
  | { kind: "unknown_previous" } // 前回unknownだったが、今回は比較可能な情報を取得できた
  | { kind: "increased" }
  | { kind: "decreased" }
  | { kind: "same" };

/**
 * 前回・今回のRiskLevelから、意味ベースの比較結果を返す純粋関数。
 * unknownを数値として扱わないため、unknownが絡む場合は必ず
 * unknown_now/unknown_previous/both_unknownのいずれかになる
 * (increased/decreased/sameにはならない)。
 */
export function compareRiskLevels(previous: RiskLevel | null, current: RiskLevel): RiskComparison {
  if (previous === null) return { kind: "no_previous" };
  if (previous === "unknown" && current === "unknown") return { kind: "both_unknown" };
  if (current === "unknown") return { kind: "unknown_now" };
  if (previous === "unknown") return { kind: "unknown_previous" };

  const previousRank = RISK_ORDER[previous];
  const currentRank = RISK_ORDER[current];
  if (currentRank > previousRank) return { kind: "increased" };
  if (currentRank < previousRank) return { kind: "decreased" };
  return { kind: "same" };
}

/**
 * 前回確認時刻を「◯分前」「15:20」のように表す。新しい日付ライブラリは追加せず、
 * 標準のDate処理のみを使う。nowを引数で受け取れるようにし、テストで固定できる
 * ようにしている。
 */
export function formatPreviousCheckedAt(evaluatedAt: string, now: Date = new Date()): string {
  const evaluated = new Date(evaluatedAt);
  const diffMs = now.getTime() - evaluated.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);

  if (Number.isNaN(evaluated.getTime())) return "不明な時刻";
  if (diffMinutes < 1) return "たった今";
  if (diffMinutes < 60) return `${diffMinutes}分前`;

  const sameDay =
    evaluated.getFullYear() === now.getFullYear() &&
    evaluated.getMonth() === now.getMonth() &&
    evaluated.getDate() === now.getDate();
  if (sameDay) {
    return evaluated.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  }
  return evaluated.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isValidEntry(value: unknown): value is RiskHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const validLevel = v.level === "unknown" || v.level === "safe" || v.level === "caution" || v.level === "prepare" || v.level === "evacuate";
  return validLevel && typeof v.evaluatedAt === "string";
}

// window.localStorageのうち実際に使う2メソッドだけを抜き出した最小の型。
// テストでは本物のlocalStorage(ブラウザ専用/jsdom等が必要)を用意する代わりに、
// この形だけ満たす単純なインメモリオブジェクトを渡せるようにする
// (このプロジェクトの他の箇所と同じ、依存性注入によるテスト容易性の確保)。
type RiskHistoryStorage = Pick<Storage, "getItem" | "setItem">;

function resolveStorage(storage?: RiskHistoryStorage): RiskHistoryStorage | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function readHistory(storage: RiskHistoryStorage): RiskHistoryEntry[] {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isValidEntry);
}

/** 現在保存されている履歴をそのまま返す(古い順)。将来の時系列表示拡張用。 */
export function getRiskHistory(storage?: RiskHistoryStorage): RiskHistoryEntry[] {
  try {
    const store = resolveStorage(storage);
    if (!store) return [];
    return readHistory(store);
  } catch {
    return [];
  }
}

export type RecordRiskHistoryResult = {
  previous: RiskHistoryEntry | null;
  comparison: RiskComparison;
};

/**
 * assessRisk()の評価が完了した直後に呼び出す。前回の履歴と比較した結果を返しつつ、
 * 今回の結果を履歴へ追記する(前回と同じlevelの場合は追記しない。初回は必ず追記する)。
 *
 * 【重要】localStorageが使えない場合でも例外を投げない。呼び出し側(RiskCard等)の
 * 表示が壊れないよう、失敗時は「比較データなし」として扱う。
 *
 * storage引数は本番では省略してよい(既定でwindow.localStorageを使う)。
 * テストからインメモリのstorageを注入できるようにするためだけの引数。
 */
export function recordRiskHistoryEntry(
  level: RiskLevel,
  evaluatedAt: string,
  storage?: RiskHistoryStorage
): RecordRiskHistoryResult {
  try {
    const store = resolveStorage(storage);
    if (!store) throw new Error("storage is not available");

    const history = readHistory(store);
    const previous = history.length > 0 ? history[history.length - 1] : null;
    const comparison = compareRiskLevels(previous ? previous.level : null, level);

    // 案A優先: 前回と同じlevelなら重複保存しない。ただし初回(previousが無い)は必ず保存する。
    if (!previous || previous.level !== level) {
      const next = [...history, { level, evaluatedAt }].slice(-MAX_HISTORY_ENTRIES);
      store.setItem(STORAGE_KEY, JSON.stringify(next));
    }

    return { previous, comparison };
  } catch {
    // 付加機能のため、保存に失敗してもリスク表示自体は壊さない。
    return { previous: null, comparison: { kind: "no_previous" } };
  }
}
