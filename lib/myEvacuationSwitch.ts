// マイ避難スイッチ: 平常時に決めた「避難開始の目安」を、災害時に再提示するための機能。
//
// 【目的】正常性バイアス（「まだ大丈夫だろう」という判断の先延ばし）への対策として、
// 「平常時の自分が決めた基準に達した」ことを分かりやすく示す。アプリが独自判断で
// 「必ず避難してください」と断定するための仕組みではない（表示文言もそれに従う）。
//
// 【重要・2つの「ON/OFF」を混同しない】
// - featureEnabled（設定スイッチ）: この機能を利用するかどうか。ユーザーが切り替える。
// - MyEvacuationSwitchState（実際の避難スイッチ状態）: off / prepare / on / unknown。
//   既存のRiskLevel（lib/riskAssessment.ts）から決まり、ユーザーは直接切り替えない。
//
// 【重要・データ方針】
// - 保存先はこの端末のlocalStorageのみ（Phase 1）。保存するのは
//   featureEnabled・currentSwitchState・changedAt の3項目だけで、緯度経度等の
//   位置情報・GPS履歴・RiskResult本体は保存しない。サーバーへも送信しない。
// - riskAssessmentの判定仕様・RiskLevelの意味は変更しない（ここでは読み取るだけ）。
// - unknownは絶対にoff扱いしない（unknown != safe の既存方針を維持する）。
//
// 【純粋関数とI/Oの分離】lib/riskHistory.tsと同じく、状態判定・変化検出は
// localStorageに触れない純粋関数とし、読み書きは load/save/record 系の関数に閉じ込める。
// storage引数はテストからインメモリのstorageを注入するためだけのもの。

import type { RiskLevel } from "./riskAssessment.ts";

/** 実際の避難スイッチ状態。unknownは「判定不能」であり、offではない。 */
export type MyEvacuationSwitchState = "off" | "prepare" | "on" | "unknown";

/** unknownを除いた、判定できた状態（localStorageに保存する対象）。 */
export type DeterminedSwitchState = Exclude<MyEvacuationSwitchState, "unknown">;

/**
 * 「どのRiskLevelから準備/ONとみなすか」の目安。
 *
 * 【将来拡張】今回はDEFAULT_SWITCH_CRITERIAに固定しているが、将来ユーザーが
 * 「cautionで準備」「prepareでON」等を選べるよう、判定関数は目安を引数で受け取る。
 * 公式の警戒レベルをリアルタイム取得する基盤は現状存在しないため、
 * 警戒レベル連動の目安はここに含めていない（存在しないデータは使わない）。
 */
export type MyEvacuationSwitchCriteria = {
  prepareAt: Exclude<RiskLevel, "unknown" | "safe">;
  onAt: Exclude<RiskLevel, "unknown" | "safe">;
};

export const DEFAULT_SWITCH_CRITERIA: MyEvacuationSwitchCriteria = {
  prepareAt: "caution",
  onAt: "prepare",
};

// lib/riskHistory.tsのRISK_ORDERと同じ順序（unknownは順序を持たない）。
const RISK_RANK: Record<Exclude<RiskLevel, "unknown">, number> = {
  safe: 0,
  caution: 1,
  prepare: 2,
  evacuate: 3,
};

const SWITCH_RANK: Record<DeterminedSwitchState, number> = { off: 0, prepare: 1, on: 2 };

/** RiskLevel → 避難スイッチ状態。unknownは必ずunknownを返す。 */
export function riskLevelToSwitchState(
  level: RiskLevel,
  criteria: MyEvacuationSwitchCriteria = DEFAULT_SWITCH_CRITERIA
): MyEvacuationSwitchState {
  if (level === "unknown") return "unknown";
  const rank = RISK_RANK[level];
  if (rank >= RISK_RANK[criteria.onAt]) return "on";
  if (rank >= RISK_RANK[criteria.prepareAt]) return "prepare";
  return "off";
}

/**
 * 機能が無効、またはリスク判定結果がまだ無い場合はnull（何も表示しない）を返す。
 * 呼び出し側はnullのときマイ避難スイッチのUI・処理を一切動かさない。
 */
export function evaluateMyEvacuationSwitch(
  featureEnabled: boolean,
  level: RiskLevel | null,
  criteria: MyEvacuationSwitchCriteria = DEFAULT_SWITCH_CRITERIA
): MyEvacuationSwitchState | null {
  if (!featureEnabled || level === null) return null;
  return riskLevelToSwitchState(level, criteria);
}

export type SwitchTransition =
  | { kind: "initial"; to: MyEvacuationSwitchState } // 前回の状態が無い（初回・再有効化直後）
  | { kind: "unchanged"; to: DeterminedSwitchState }
  | { kind: "raised"; from: DeterminedSwitchState; to: DeterminedSwitchState } // off→準備、準備→ON 等
  | { kind: "lowered"; from: DeterminedSwitchState; to: DeterminedSwitchState } // ON→準備、ON→off 等
  | { kind: "unknown_now"; from: DeterminedSwitchState }; // 今回は判定不能（前回の状態は保持）

/** 前回状態 → 今回状態の変化を返す純粋関数。 */
export function detectSwitchTransition(
  previous: DeterminedSwitchState | null,
  current: MyEvacuationSwitchState
): SwitchTransition {
  if (previous === null) return { kind: "initial", to: current };
  if (current === "unknown") return { kind: "unknown_now", from: previous };
  if (SWITCH_RANK[current] > SWITCH_RANK[previous]) return { kind: "raised", from: previous, to: current };
  if (SWITCH_RANK[current] < SWITCH_RANK[previous]) return { kind: "lowered", from: previous, to: current };
  return { kind: "unchanged", to: current };
}

/** 今回の変化でONになったか（OFF/準備/初回 → ON）。ON時の再提示・将来の通知の起点。 */
export function becameOn(transition: SwitchTransition): boolean {
  return (transition.kind === "raised" || transition.kind === "initial") && transition.to === "on";
}

/**
 * 【通知との接続準備のみ】マイ避難スイッチがONになった瞬間に通知を送るべきかを返す。
 * 現時点ではどこからも送信処理に接続していない（クライアントからFCM送信はしない）。
 * autoNotificationEnabledにはnotificationDecisionConfig.enabled（現在false）を渡す想定で、
 * それがfalseの間は常にfalseを返す（既存の安全スイッチを迂回しない）。
 */
export function shouldNotifyMyEvacuationSwitch(
  transition: SwitchTransition,
  options: { featureEnabled: boolean; autoNotificationEnabled: boolean }
): boolean {
  if (!options.featureEnabled || !options.autoNotificationEnabled) return false;
  return becameOn(transition);
}

// ---- localStorage ----

// 将来、保存形式を変更する可能性があるためキーにバージョンを含める。
// 将来アカウント（ClerkのuserId）と紐づける場合も、この3項目をそのまま
// サーバー側のユーザー設定へ移せる形にしている。
export const MY_EVACUATION_SWITCH_STORAGE_KEY = "disaster-support:my-evacuation-switch:v1";

export type MyEvacuationSwitchSettings = {
  featureEnabled: boolean;
  /** 最後に判定できた状態（unknownは保存しない）。機能無効時・未判定時はnull。 */
  currentSwitchState: DeterminedSwitchState | null;
  /** currentSwitchStateが最後に変化した時刻（ISO 8601）。 */
  changedAt: string | null;
};

// 機能は利用者が説明を読んだうえで自分で有効にする（初期値は無効）。
export const DEFAULT_MY_EVACUATION_SWITCH_SETTINGS: MyEvacuationSwitchSettings = {
  featureEnabled: false,
  currentSwitchState: null,
  changedAt: null,
};

type SwitchStorage = Pick<Storage, "getItem" | "setItem">;

function resolveStorage(storage?: SwitchStorage): SwitchStorage | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function isDeterminedState(value: unknown): value is DeterminedSwitchState {
  return value === "off" || value === "prepare" || value === "on";
}

function parseSettings(raw: string | null): MyEvacuationSwitchSettings {
  if (!raw) return DEFAULT_MY_EVACUATION_SWITCH_SETTINGS;
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") return DEFAULT_MY_EVACUATION_SWITCH_SETTINGS;
  const v = parsed as Record<string, unknown>;
  return {
    featureEnabled: v.featureEnabled === true,
    currentSwitchState: isDeterminedState(v.currentSwitchState) ? v.currentSwitchState : null,
    changedAt: typeof v.changedAt === "string" ? v.changedAt : null,
  };
}

/** 保存済みの設定を読む。読めない・壊れている場合は既定値（機能無効）を返し、例外は投げない。 */
export function loadMyEvacuationSwitchSettings(storage?: SwitchStorage): MyEvacuationSwitchSettings {
  try {
    const store = resolveStorage(storage);
    if (!store) return DEFAULT_MY_EVACUATION_SWITCH_SETTINGS;
    return parseSettings(store.getItem(MY_EVACUATION_SWITCH_STORAGE_KEY));
  } catch {
    return DEFAULT_MY_EVACUATION_SWITCH_SETTINGS;
  }
}

/** 保存に成功したらtrue。失敗してもアプリ本体は壊さない（画面上の設定はそのまま使える）。 */
function writeSettings(settings: MyEvacuationSwitchSettings, storage?: SwitchStorage): boolean {
  try {
    const store = resolveStorage(storage);
    if (!store) return false;
    store.setItem(MY_EVACUATION_SWITCH_STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

/**
 * 機能の有効/無効を切り替える。無効化・再有効化のどちらでも前回の状態は消す
 * （再有効化した直後に、古い状態との比較で「目安を下回りました」等と出さないため）。
 */
export function saveMyEvacuationSwitchEnabled(
  enabled: boolean,
  storage?: SwitchStorage
): { settings: MyEvacuationSwitchSettings; saved: boolean } {
  const settings: MyEvacuationSwitchSettings = { featureEnabled: enabled, currentSwitchState: null, changedAt: null };
  return { settings, saved: writeSettings(settings, storage) };
}

export type RecordSwitchStateResult = {
  state: MyEvacuationSwitchState;
  transition: SwitchTransition;
  /** 現在の状態になった時刻（unknownの場合は前回状態の時刻）。 */
  changedAt: string | null;
};

/**
 * リスク判定が完了した直後に呼ぶ。機能が無効な場合はnullを返し、何も保存しない。
 * unknownの場合は前回の状態を上書きしない（判定不能をOFFとして記録しない）。
 *
 * featureEnabledは画面側が保持している現在の設定を渡す（localStorageが使えない環境でも、
 * その場で有効にした設定のまま動作させるため。その場合、前回状態との比較は毎回「初回」になる）。
 */
export function recordMyEvacuationSwitchState(
  featureEnabled: boolean,
  level: RiskLevel,
  now: string,
  storage?: SwitchStorage,
  criteria: MyEvacuationSwitchCriteria = DEFAULT_SWITCH_CRITERIA
): RecordSwitchStateResult | null {
  const state = evaluateMyEvacuationSwitch(featureEnabled, level, criteria);
  if (state === null) return null;
  const settings = loadMyEvacuationSwitchSettings(storage);

  const transition = detectSwitchTransition(settings.currentSwitchState, state);
  if (state === "unknown") return { state, transition, changedAt: settings.changedAt };

  const changed = settings.currentSwitchState !== state;
  const changedAt = changed ? now : settings.changedAt;
  if (changed) writeSettings({ featureEnabled: true, currentSwitchState: state, changedAt }, storage);
  return { state, transition, changedAt };
}
