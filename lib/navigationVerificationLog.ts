// 試作3 次段階 PART 2・6: ナビゲーションの実地検証用ログ。
//
// 【重要】要件定義書2 PART 6の指示どおり、位置履歴をサーバーへ保存しない。
// このログは端末内（ブラウザのメモリ上）にのみ保持し、案内終了時に
// JSONファイルとして端末にダウンロードできるようにするだけである
// （研究・デバッグ用。Firestore等への送信は一切行わない）。
//
// 新しいナビ機能は、この実地検証ログをもとに逸脱・到着閾値等を確認する
// までは「完成」として扱わない（要件定義書2の方針）。

import type { LatLng } from "./navigation";

export type NavVerificationLogEntry = {
  /** ログを記録した時刻(ISO文字列) */
  timestamp: string;
  event: "started" | "update" | "ended";
  navigationStartedAt: string;
  /** このセッションでナビしているルートを識別する簡易ID（研究用途のみ） */
  selectedRouteId: string;
  gpsAccuracyMeters: number | null;
  position: LatLng | null;
  /** 目的地までの残り推定距離(m) */
  distanceRemainingMeters: number | null;
  /** 表示中の案内文言（「120m先 左折」等の元になったテキスト） */
  currentInstruction: string | null;
  routeDeviation: boolean | null;
  hasArrived: boolean | null;
  /** "ended"イベントの時のみ値が入る */
  navigationEndedAt: string | null;
};

export function buildLogEntry(params: {
  event: NavVerificationLogEntry["event"];
  navigationStartedAt: string;
  selectedRouteId: string;
  gpsAccuracyMeters?: number | null;
  position?: LatLng | null;
  distanceRemainingMeters?: number | null;
  currentInstruction?: string | null;
  routeDeviation?: boolean | null;
  hasArrived?: boolean | null;
  navigationEndedAt?: string | null;
}): NavVerificationLogEntry {
  return {
    timestamp: new Date().toISOString(),
    event: params.event,
    navigationStartedAt: params.navigationStartedAt,
    selectedRouteId: params.selectedRouteId,
    gpsAccuracyMeters: params.gpsAccuracyMeters ?? null,
    position: params.position ?? null,
    distanceRemainingMeters: params.distanceRemainingMeters ?? null,
    currentInstruction: params.currentInstruction ?? null,
    routeDeviation: params.routeDeviation ?? null,
    hasArrived: params.hasArrived ?? null,
    navigationEndedAt: params.navigationEndedAt ?? null,
  };
}

/** ログ配列をダウンロード用JSON文字列にする（純粋関数・テスト容易） */
export function serializeVerificationLog(entries: NavVerificationLogEntry[]): string {
  return JSON.stringify(entries, null, 2);
}

/**
 * ブラウザ上でJSONファイルとしてダウンロードさせる（ブラウザ専用、I/Oあり）。
 * サーバーへは一切送信しない。
 */
export function triggerVerificationLogDownload(entries: NavVerificationLogEntry[]): void {
  if (typeof window === "undefined" || entries.length === 0) return;
  const json = serializeVerificationLog(entries);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `nav-verification-log-${entries[0].navigationStartedAt.replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
