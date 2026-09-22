"use client";

// 試作3 PART D: 通知対象地点の登録・削除（クライアント側ヘルパー）。
//
// 【重要】PART D-2の方針により、ユーザーが明示的に登録操作をした場合のみ
// サーバー(Firestore)へ位置情報を保存する。GPS移動履歴は継続保存しない
// （登録した瞬間の1地点のスナップショットのみ）。
// このアプリにはアカウント機能が無いため、「自分が登録した地点」を
// このブラウザで覚えておくためだけにlocalStorageへID(1件)を保存する
// （個人情報ではなく、Firestore上のドキュメントIDのみ）。
//
// 【2026-09-10 追記】GET /api/monitoring-points/:id にも所有者確認
// (fcmToken一致)を追加したため、登録時に使ったfcmTokenもあわせて
// localStorageへ保存する。これにより、アプリ再訪時（起動直後の
// 「登録済みか確認」処理）でrequestFcmToken()を再度呼ばずに済む
// （PART C-3: 起動直後に通知許可プロンプトを出してはいけない、という
// 既存方針を壊さないため。トークン自体は既存の登録/削除/更新APIへも
// 平文でそのまま送信している値であり、ここで新たに機密性の高い情報を
// 増やすものではない）。

const STORAGE_KEY = "osaka-hinan-app:monitoringPointId";
const STORAGE_KEY_TOKEN = "osaka-hinan-app:monitoringPointToken";

export function getSavedMonitoringPointId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveMonitoringPointId(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // プライベートブラウズ等でlocalStorageが使えない場合は諦める（機能自体は使える）
  }
}

export function getSavedMonitoringPointToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY_TOKEN);
  } catch {
    return null;
  }
}

function saveMonitoringPointToken(token: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (token) window.localStorage.setItem(STORAGE_KEY_TOKEN, token);
    else window.localStorage.removeItem(STORAGE_KEY_TOKEN);
  } catch {
    // プライベートブラウズ等でlocalStorageが使えない場合は諦める（機能自体は使える）
  }
}

export type MonitoringPointInfo = {
  monitoringPointId: string;
  latitude: number;
  longitude: number;
  enabledHazards: string[];
  notificationEnabled: boolean;
  // 試作3 PART1-3: 重複通知防止・監視ジョブ技術検証用フィールド(まだ実運用はしていない)
  lastNotificationState: string | null;
  lastNotifiedAt: string | null;
  lastEvaluatedForecastTime: string | null;
  decisionVersion: string | null;
};

export async function registerMonitoringPoint(params: {
  latitude: number;
  longitude: number;
  fcmToken: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/monitoring-points", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        latitude: params.latitude,
        longitude: params.longitude,
        enabledHazards: ["flood", "inundation"],
        fcmToken: params.fcmToken,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.monitoringPointId) {
      return { ok: false, error: data?.error ?? "登録に失敗しました" };
    }
    saveMonitoringPointId(data.monitoringPointId);
    saveMonitoringPointToken(params.fcmToken);
    return { ok: true, id: data.monitoringPointId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "通信エラー" };
  }
}

/**
 * 監視地点の詳細を取得する。GET側にも所有者確認(fcmToken一致)があるため、
 * トークンを"x-fcm-token"ヘッダーで送る(DELETE/PATCHはボディで送る既存方式のまま)。
 */
export async function fetchMonitoringPoint(id: string, fcmToken: string): Promise<MonitoringPointInfo | null> {
  try {
    const res = await fetch(`/api/monitoring-points/${id}`, {
      headers: { "x-fcm-token": fcmToken },
    });
    if (!res.ok) return null;
    return (await res.json()) as MonitoringPointInfo;
  } catch {
    return null;
  }
}

export async function deleteMonitoringPoint(id: string, fcmToken: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/monitoring-points/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fcmToken }),
    });
    if (res.ok) {
      saveMonitoringPointId(null);
      saveMonitoringPointToken(null);
    }
    return res.ok;
  } catch {
    return false;
  }
}

export async function setMonitoringPointEnabled(
  id: string,
  fcmToken: string,
  enabled: boolean
): Promise<boolean> {
  try {
    const res = await fetch(`/api/monitoring-points/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fcmToken, notificationEnabled: enabled }),
    });
    // 使ったトークンで実際に更新できた=このトークンが最新の有効な所有者証明。
    // ローカル保存分をこれに合わせておく(トークンがローテーションしていた場合の追従)。
    if (res.ok) saveMonitoringPointToken(fcmToken);
    return res.ok;
  } catch {
    return false;
  }
}
