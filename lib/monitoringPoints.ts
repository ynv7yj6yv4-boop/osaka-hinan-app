"use client";

// 試作3 PART D: 通知対象地点の登録・削除（クライアント側ヘルパー）。
//
// 【重要】PART D-2の方針により、ユーザーが明示的に登録操作をした場合のみ
// サーバー(Firestore)へ位置情報を保存する。GPS移動履歴は継続保存しない
// （登録した瞬間の1地点のスナップショットのみ）。
// このアプリにはアカウント機能が無いため、「自分が登録した地点」を
// このブラウザで覚えておくためだけにlocalStorageへID(1件)を保存する
// （個人情報ではなく、Firestore上のドキュメントIDのみ）。

const STORAGE_KEY = "osaka-hinan-app:monitoringPointId";

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

export type MonitoringPointInfo = {
  monitoringPointId: string;
  latitude: number;
  longitude: number;
  enabledHazards: string[];
  notificationEnabled: boolean;
  lastNotification: { status: string; at: string } | null;
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
    return { ok: true, id: data.monitoringPointId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "通信エラー" };
  }
}

export async function fetchMonitoringPoint(id: string): Promise<MonitoringPointInfo | null> {
  try {
    const res = await fetch(`/api/monitoring-points/${id}`);
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
    if (res.ok) saveMonitoringPointId(null);
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
    return res.ok;
  } catch {
    return false;
  }
}
