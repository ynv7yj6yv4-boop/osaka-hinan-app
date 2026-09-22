// functions/src/devSimulationCheck.ts の単体テスト。
//
// 【このファイルの位置づけ】要件定義書4後続(開発者限定自動通知パイプライン
// 検証)で最も重要な2つの不変条件を検証する。
// 1. targetMonitoringPointIdがallowlistと一致しない限り、Firestoreへの
//    アクセス自体が発生しない(他地点への到達経路が無いこと)。
// 2. このシミュレーション経路を通っても、本番のnotificationDecisionConfig
//    (シングルトン)のenabledはfalseのまま変化しない。
// FCMの実送信・Firestoreの実I/Oは行わず、いずれもモック化する
// (要件定義書4 §9の方針を踏襲)。

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import { runDeveloperNotificationSimulation } from "./devSimulationCheck";
import { notificationDecisionConfig } from "./notificationDecisionConfig";
import type { FcmSendResult } from "./fcmSender";

const NOW = new Date("2026-09-23T00:00:00.000Z");

function countingSendFn(result: FcmSendResult) {
  let calls = 0;
  const fn = async () => {
    calls++;
    return result;
  };
  return { fn, getCalls: () => calls };
}

// collectionが呼ばれた時点でテスト失敗にする、Firestoreアクセスなしを
// 証明するための「触れたら即エラー」なfakeDb。
function createUnreachableDb(): Firestore {
  return {
    collection() {
      throw new Error("Firestoreへアクセスしてはいけない(allowlist不一致のはず)");
    },
  } as unknown as Firestore;
}

function createFakeDb(pointData: Record<string, unknown> | null) {
  const setCalls: unknown[] = [];
  const updateCalls: unknown[] = [];
  let committed = false;

  const db = {
    collection(name: string) {
      if (name === "monitoringPoints") {
        return {
          doc(id: string) {
            return {
              id,
              get: async () => ({
                exists: pointData !== null,
                data: () => pointData,
              }),
            };
          },
        };
      }
      if (name === "notificationLogs") {
        return {
          doc() {
            return { id: "fake-log-doc" };
          },
        };
      }
      throw new Error(`想定外のcollection: ${name}`);
    },
    batch() {
      return {
        set(_ref: unknown, data: unknown) {
          setCalls.push(data);
        },
        update(_ref: unknown, data: unknown) {
          updateCalls.push(data);
        },
        commit: async () => {
          committed = true;
        },
      };
    },
  } as unknown as Firestore;

  return { db, setCalls, updateCalls, isCommitted: () => committed };
}

test("【最重要】allowlistと不一致ならFirestoreへ一切アクセスせず、送信関数も呼ばれない", async () => {
  const { fn, getCalls } = countingSendFn({ ok: true });
  const db = createUnreachableDb();
  const result = await runDeveloperNotificationSimulation(db, "point-A", "point-B", { now: NOW, sendFcmNotification: fn });
  assert.equal(result.status, "blocked_id_mismatch");
  assert.equal(getCalls(), 0);
});

test("allowlistが空文字の場合もブロックする", async () => {
  const { fn, getCalls } = countingSendFn({ ok: true });
  const db = createUnreachableDb();
  const result = await runDeveloperNotificationSimulation(db, "point-A", "", { now: NOW, sendFcmNotification: fn });
  assert.equal(result.status, "blocked_id_mismatch");
  assert.equal(getCalls(), 0);
});

test("【最重要】このシミュレーション経路を通っても、本番notificationDecisionConfig.enabledはfalseのまま変化しない", async () => {
  assert.equal(notificationDecisionConfig.enabled, false, "テスト実行前の前提");
  const { fn } = countingSendFn({ ok: true });
  const { db } = createFakeDb({ fcmToken: "dev-token" });
  await runDeveloperNotificationSimulation(db, "dev-point", "dev-point", { now: NOW, sendFcmNotification: fn });
  assert.equal(notificationDecisionConfig.enabled, false, "テスト実行後もシングルトンは書き換わっていないはず");
});

test("対象ドキュメントが存在しない場合はnot_foundを返し、送信関数は呼ばれない", async () => {
  const { fn, getCalls } = countingSendFn({ ok: true });
  const { db } = createFakeDb(null);
  const result = await runDeveloperNotificationSimulation(db, "dev-point", "dev-point", { now: NOW, sendFcmNotification: fn });
  assert.equal(result.status, "not_found");
  assert.equal(getCalls(), 0);
});

test("allowlist一致・ドキュメント存在・送信成功: candidate判定となり送信関数が1回だけ呼ばれ、notificationLogsとcooldownが記録される", async () => {
  const { fn, getCalls } = countingSendFn({ ok: true });
  const { db, setCalls, updateCalls, isCommitted } = createFakeDb({ fcmToken: "dev-token" });

  const result = await runDeveloperNotificationSimulation(db, "dev-point", "dev-point", {
    now: NOW,
    gitCommitHash: "abc123",
    sendFcmNotification: fn,
  });

  assert.equal(getCalls(), 1);
  assert.deepEqual(result, {
    status: "completed",
    decisionType: "candidate",
    sendAttempted: true,
    sendResult: "success",
    sendErrorCode: null,
    autoDisabledPoint: false,
  });
  assert.equal(setCalls.length, 1);
  const logDoc = setCalls[0] as { executionMode: string; monitoringPointId: string; gitCommitHash: string };
  assert.equal(logDoc.executionMode, "simulation");
  assert.equal(logDoc.monitoringPointId, "dev-point");
  assert.equal(logDoc.gitCommitHash, "abc123");
  assert.equal(updateCalls.length, 1);
  assert.deepEqual(updateCalls[0], { lastNotifiedAt: NOW.toISOString(), lastNotificationState: "sent" });
  assert.equal(isCommitted(), true);
});

test("送信失敗(一時的エラー)の場合: cooldown更新は行われず、notificationEnabledも変更されない", async () => {
  const { fn } = countingSendFn({ ok: false, errorCode: "messaging/internal-error", permanent: false });
  const { db, updateCalls } = createFakeDb({ fcmToken: "dev-token" });

  const result = await runDeveloperNotificationSimulation(db, "dev-point", "dev-point", { now: NOW, sendFcmNotification: fn });

  assert.equal(result.status, "completed");
  if (result.status === "completed") {
    assert.equal(result.sendResult, "failed");
    assert.equal(result.autoDisabledPoint, false);
  }
  // cooldown・notificationEnabledのいずれも変更対象が無いため、pointへのupdate自体が発生しない。
  assert.equal(updateCalls.length, 0);
});
