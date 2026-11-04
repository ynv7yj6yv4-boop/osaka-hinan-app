// lib/myEvacuationSwitch.ts・lib/myEvacuationSwitchMessages.ts の単体テスト。
// localStorageは本物の代わりにインメモリstorageを注入して検証する（lib/riskHistory.test.tsと同じ方針）。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  riskLevelToSwitchState,
  evaluateMyEvacuationSwitch,
  detectSwitchTransition,
  becameOn,
  shouldNotifyMyEvacuationSwitch,
  loadMyEvacuationSwitchSettings,
  saveMyEvacuationSwitchEnabled,
  recordMyEvacuationSwitchState,
  MY_EVACUATION_SWITCH_STORAGE_KEY,
  DEFAULT_MY_EVACUATION_SWITCH_SETTINGS,
} from "./myEvacuationSwitch.ts";
import { describeMyEvacuationSwitch } from "./myEvacuationSwitchMessages.ts";

function createFakeStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

const throwingStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

// --- RiskLevel → スイッチ状態 ---

test("safe → OFF", () => assert.equal(riskLevelToSwitchState("safe"), "off"));
test("caution → 準備", () => assert.equal(riskLevelToSwitchState("caution"), "prepare"));
test("prepare → ON", () => assert.equal(riskLevelToSwitchState("prepare"), "on"));
test("evacuate → ON", () => assert.equal(riskLevelToSwitchState("evacuate"), "on"));
test("unknown → unknown（OFF扱いしない）", () => assert.equal(riskLevelToSwitchState("unknown"), "unknown"));

test("目安を引数で変えられる（将来のユーザー独自条件の土台）", () => {
  const criteria = { prepareAt: "prepare", onAt: "evacuate" } as const;
  assert.equal(riskLevelToSwitchState("caution", criteria), "off");
  assert.equal(riskLevelToSwitchState("prepare", criteria), "prepare");
  assert.equal(riskLevelToSwitchState("evacuate", criteria), "on");
  assert.equal(riskLevelToSwitchState("unknown", criteria), "unknown");
});

test("feature disabled: どのRiskLevelでもnull（UI・処理を動かさない）", () => {
  for (const level of ["unknown", "safe", "caution", "prepare", "evacuate"] as const) {
    assert.equal(evaluateMyEvacuationSwitch(false, level), null);
  }
});

test("リスク判定結果がまだ無い場合はnull", () => {
  assert.equal(evaluateMyEvacuationSwitch(true, null), null);
});

// --- 状態変化 ---

test("OFF → 準備 は raised", () => {
  assert.deepEqual(detectSwitchTransition("off", "prepare"), { kind: "raised", from: "off", to: "prepare" });
});
test("準備 → ON は raised で、becameOn", () => {
  const t = detectSwitchTransition("prepare", "on");
  assert.deepEqual(t, { kind: "raised", from: "prepare", to: "on" });
  assert.equal(becameOn(t), true);
});
test("ON → 準備 は lowered", () => {
  assert.deepEqual(detectSwitchTransition("on", "prepare"), { kind: "lowered", from: "on", to: "prepare" });
});
test("ON → OFF は lowered", () => {
  assert.deepEqual(detectSwitchTransition("on", "off"), { kind: "lowered", from: "on", to: "off" });
});
test("同じ状態は unchanged（ON継続はbecameOnではない）", () => {
  const t = detectSwitchTransition("on", "on");
  assert.deepEqual(t, { kind: "unchanged", to: "on" });
  assert.equal(becameOn(t), false);
});
test("前回なし → ON は initial かつ becameOn", () => {
  const t = detectSwitchTransition(null, "on");
  assert.deepEqual(t, { kind: "initial", to: "on" });
  assert.equal(becameOn(t), true);
});
test("ON → unknown は unknown_now（loweredにもOFFにもしない）", () => {
  assert.deepEqual(detectSwitchTransition("on", "unknown"), { kind: "unknown_now", from: "on" });
});

// --- 通知との接続準備 ---

test("feature OFF時は通知処理が動作しない", () => {
  const t = detectSwitchTransition("prepare", "on");
  assert.equal(shouldNotifyMyEvacuationSwitch(t, { featureEnabled: false, autoNotificationEnabled: true }), false);
});
test("自動通知の安全スイッチ(notificationDecisionConfig.enabled)がfalseなら通知しない", () => {
  const t = detectSwitchTransition("prepare", "on");
  assert.equal(shouldNotifyMyEvacuationSwitch(t, { featureEnabled: true, autoNotificationEnabled: false }), false);
});
test("両方有効で、ONになった瞬間だけtrue", () => {
  const opts = { featureEnabled: true, autoNotificationEnabled: true };
  assert.equal(shouldNotifyMyEvacuationSwitch(detectSwitchTransition("prepare", "on"), opts), true);
  assert.equal(shouldNotifyMyEvacuationSwitch(detectSwitchTransition("on", "on"), opts), false);
  assert.equal(shouldNotifyMyEvacuationSwitch(detectSwitchTransition("on", "prepare"), opts), false);
  assert.equal(shouldNotifyMyEvacuationSwitch(detectSwitchTransition("off", "unknown"), opts), false);
});

// --- localStorage ---

test("未保存なら既定値（機能は無効）", () => {
  assert.deepEqual(loadMyEvacuationSwitchSettings(createFakeStorage()), DEFAULT_MY_EVACUATION_SWITCH_SETTINGS);
});

test("有効化を保存し、読み戻せる。保存するのは3項目のみで位置情報を含まない", () => {
  const storage = createFakeStorage();
  const { saved } = saveMyEvacuationSwitchEnabled(true, storage);
  assert.equal(saved, true);
  assert.equal(loadMyEvacuationSwitchSettings(storage).featureEnabled, true);

  recordMyEvacuationSwitchState(true, "prepare", "2026-11-04T10:00:00.000Z", storage);
  const raw = JSON.parse(storage.data.get(MY_EVACUATION_SWITCH_STORAGE_KEY) ?? "{}");
  assert.deepEqual(Object.keys(raw).sort(), ["changedAt", "currentSwitchState", "featureEnabled"]);
  assert.deepEqual(raw, { featureEnabled: true, currentSwitchState: "on", changedAt: "2026-11-04T10:00:00.000Z" });
});

test("OFF→準備→ON→準備→OFF の一連の変化を記録し、changedAtは変化時のみ更新", () => {
  const storage = createFakeStorage();
  saveMyEvacuationSwitchEnabled(true, storage);

  assert.equal(recordMyEvacuationSwitchState(true, "safe", "t1", storage)?.transition.kind, "initial");
  assert.deepEqual(recordMyEvacuationSwitchState(true, "caution", "t2", storage)?.transition, { kind: "raised", from: "off", to: "prepare" });
  const on = recordMyEvacuationSwitchState(true, "prepare", "t3", storage);
  assert.deepEqual(on?.transition, { kind: "raised", from: "prepare", to: "on" });
  assert.equal(on?.changedAt, "t3");

  const stillOn = recordMyEvacuationSwitchState(true, "evacuate", "t4", storage);
  assert.equal(stillOn?.transition.kind, "unchanged");
  assert.equal(stillOn?.changedAt, "t3");

  assert.deepEqual(recordMyEvacuationSwitchState(true, "caution", "t5", storage)?.transition, { kind: "lowered", from: "on", to: "prepare" });
  assert.deepEqual(recordMyEvacuationSwitchState(true, "safe", "t6", storage)?.transition, { kind: "lowered", from: "prepare", to: "off" });
});

test("unknownは保存済みの状態を上書きしない", () => {
  const storage = createFakeStorage();
  saveMyEvacuationSwitchEnabled(true, storage);
  recordMyEvacuationSwitchState(true, "prepare", "t1", storage);
  const r = recordMyEvacuationSwitchState(true, "unknown", "t2", storage);
  assert.equal(r?.state, "unknown");
  assert.deepEqual(r?.transition, { kind: "unknown_now", from: "on" });
  assert.equal(loadMyEvacuationSwitchSettings(storage).currentSwitchState, "on");
  assert.equal(loadMyEvacuationSwitchSettings(storage).changedAt, "t1");
});

test("feature OFF時はrecordしても何も保存しない", () => {
  const storage = createFakeStorage();
  assert.equal(recordMyEvacuationSwitchState(false, "prepare", "t1", storage), null);
  assert.equal(storage.data.size, 0);
});

test("無効化すると前回状態を消す（再有効化直後に古い状態と比較しない）", () => {
  const storage = createFakeStorage();
  saveMyEvacuationSwitchEnabled(true, storage);
  recordMyEvacuationSwitchState(true, "prepare", "t1", storage);
  saveMyEvacuationSwitchEnabled(false, storage);
  assert.deepEqual(loadMyEvacuationSwitchSettings(storage), DEFAULT_MY_EVACUATION_SWITCH_SETTINGS);
  saveMyEvacuationSwitchEnabled(true, storage);
  assert.equal(recordMyEvacuationSwitchState(true, "safe", "t2", storage)?.transition.kind, "initial");
});

test("localStorage失敗時も例外を投げず、既定値・未保存として扱う", () => {
  assert.deepEqual(loadMyEvacuationSwitchSettings(throwingStorage), DEFAULT_MY_EVACUATION_SWITCH_SETTINGS);
  const result = saveMyEvacuationSwitchEnabled(true, throwingStorage);
  assert.equal(result.saved, false);
  assert.equal(result.settings.featureEnabled, true);
  // 保存できなくても、画面側で有効にした設定のままスイッチ状態は判定できる（前回比較は毎回「初回」）。
  const recorded = recordMyEvacuationSwitchState(true, "prepare", "t1", throwingStorage);
  assert.equal(recorded?.state, "on");
  assert.equal(recorded?.transition.kind, "initial");
});

test("壊れたJSON・不正な値は既定値として扱う", () => {
  const storage = createFakeStorage();
  storage.setItem(MY_EVACUATION_SWITCH_STORAGE_KEY, "{not json");
  assert.deepEqual(loadMyEvacuationSwitchSettings(storage), DEFAULT_MY_EVACUATION_SWITCH_SETTINGS);
  storage.setItem(MY_EVACUATION_SWITCH_STORAGE_KEY, JSON.stringify({ featureEnabled: "yes", currentSwitchState: "unknown" }));
  assert.deepEqual(loadMyEvacuationSwitchSettings(storage), DEFAULT_MY_EVACUATION_SWITCH_SETTINGS);
});

// --- 表示文言 ---

const ALL_TEXT = (m: ReturnType<typeof describeMyEvacuationSwitch>) => `${m.title}${m.body}${m.note ?? ""}`;

test("ON時は「平常時に設定した避難開始の目安」を伝え、ONになった瞬間は専用の見出し", () => {
  const m = describeMyEvacuationSwitch("on", detectSwitchTransition("prepare", "on"));
  assert.equal(m.title, "マイ避難スイッチがONになりました");
  assert.match(m.body, /平常時に設定した避難開始の目安に達しています/);
  assert.equal(describeMyEvacuationSwitch("on", detectSwitchTransition("on", "on")).title, "マイ避難スイッチ：ON");
});

test("どの状態でも「安全です」「必ず避難」等の断定表現を使わない", () => {
  const cases = [
    describeMyEvacuationSwitch("off", null),
    describeMyEvacuationSwitch("off", detectSwitchTransition("on", "off")),
    describeMyEvacuationSwitch("off", detectSwitchTransition("prepare", "off")),
    describeMyEvacuationSwitch("prepare", detectSwitchTransition("off", "prepare")),
    describeMyEvacuationSwitch("prepare", detectSwitchTransition("on", "prepare")),
    describeMyEvacuationSwitch("on", detectSwitchTransition("prepare", "on")),
    describeMyEvacuationSwitch("unknown", null),
  ];
  for (const m of cases) {
    assert.doesNotMatch(ALL_TEXT(m), /安全です|安全になりました|必ず避難|避難してください/);
  }
});

test("ON→OFFでは目安を下回ったことと公式情報の確認を促す", () => {
  const m = describeMyEvacuationSwitch("off", detectSwitchTransition("on", "off"));
  assert.match(m.body, /避難開始の目安を下回りました/);
  assert.match(m.note ?? "", /公式情報/);
});

test("unknownはOFFと異なる「判定できません」表示", () => {
  const unknown = describeMyEvacuationSwitch("unknown", null);
  const off = describeMyEvacuationSwitch("off", null);
  assert.match(unknown.body, /判定できません/);
  assert.notEqual(unknown.title, off.title);
});
