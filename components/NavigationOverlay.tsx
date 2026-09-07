"use client";

// 試作3 PART A-4・A-6・A-8・A-9: ナビ中のHTMLオーバーレイ表示。
// 地図(components/NavTracker.tsx側)とは分離し、こちらは表示のみを担当する。

import type { NavigationDisplayState } from "@/lib/navigation";

function formatMeters(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`;
}

export default function NavigationOverlay({
  state,
  destinationName,
  onEnd,
  onRecalculate,
  isRecalculating,
  recalculateError,
}: {
  state: NavigationDisplayState | null;
  destinationName: string;
  onEnd: () => void;
  onRecalculate: () => void;
  isRecalculating: boolean;
  recalculateError: string | null;
}) {
  return (
    <>
      {/* 上部：次の案内（A-4: ナビ中は地図を最優先し、案内は小型表示にとどめる） */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-[1000] p-3"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <div className="pointer-events-auto rounded-xl bg-white/95 px-4 py-2.5 shadow">
          {!state ? (
            <p className="text-sm text-zinc-600">現在地を取得しています…</p>
          ) : state.hasArrived ? (
            // A-8: 「安全な場所に到着しました」等の断定表現は使用しない
            <p className="text-base font-bold text-emerald-700">📍 避難先付近に到着しました</p>
          ) : state.nextInstructionJa ? (
            <p className="text-base font-bold text-zinc-900">
              {formatMeters(state.distanceToNextManeuverMeters)}先 {state.nextInstructionJa}
            </p>
          ) : (
            <p className="text-base font-bold text-zinc-900">{destinationName}へ向かっています</p>
          )}
          {state?.gpsSignalLost && (
            <p className="mt-0.5 text-[11px] text-amber-700">
              ⚠ 現在地の電波状況が良くないようです（直前の位置を表示しています）
            </p>
          )}
        </div>
      </div>

      {/* 下部：逸脱注意・残り距離・免責・終了ボタン */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[1000] flex flex-col gap-2 p-3"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        {/* A-6: 具体的な閾値・連続回数の根拠はlib/navigation.tsのコメント参照。
            A-7: ここでは自動で別ルートへ変更せず、ユーザー操作でのみ再取得する。 */}
        {state?.isOffRoute && !state.hasArrived && (
          <div className="pointer-events-auto rounded-lg border-2 border-amber-300 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900 shadow">
            <p>⚠ 参考ルートから外れている可能性があります（GPSの誤差の可能性もあります）</p>
            <button
              type="button"
              onClick={onRecalculate}
              disabled={isRecalculating}
              className="mt-2 w-full rounded-lg border-2 border-amber-400 bg-white py-2 text-sm font-bold text-amber-900 active:bg-amber-50 disabled:opacity-60"
            >
              {isRecalculating ? "現在地から再確認しています…" : "🔄 現在地からルートを再確認"}
            </button>
            {recalculateError && (
              <p className="mt-1 text-xs font-normal text-red-700">{recalculateError}</p>
            )}
          </div>
        )}

        <div className="pointer-events-auto rounded-xl bg-white/95 px-4 py-2.5 shadow">
          <p className="text-sm text-zinc-700">
            {destinationName} まで残り約{state ? formatMeters(state.distanceRemainingMeters) : "―"}
          </p>
          {/* A-9: ナビ中も参考ルートであることの免責を確認できるようにする */}
          <p className="mt-1 text-[11px] leading-snug text-zinc-500">
            ※この経路は参考です。冠水・通行止め・倒木・工事・火災・混雑等の実際の道路状況は反映していません。現地の状況を優先してください。
          </p>
        </div>

        <button
          type="button"
          onClick={onEnd}
          className="pointer-events-auto w-full rounded-lg border-2 border-zinc-400 bg-white py-3 text-base font-bold text-zinc-800 shadow active:bg-zinc-50"
        >
          案内を終了
        </button>
      </div>
    </>
  );
}
