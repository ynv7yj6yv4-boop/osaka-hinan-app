"use client";

// 試作3 PART A-4・A-6・A-8・A-9: ナビ中のHTMLオーバーレイ表示。
// 地図(components/NavTracker.tsx側)とは分離し、こちらは表示のみを担当する。

import type { NavigationDisplayState } from "@/lib/navigation";
import Button from "./ui/Button";
import Notice from "./ui/Notice";
import { SuccessIcon } from "./ui/icons";

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
        <div className="pointer-events-auto rounded-[var(--radius-lg)] bg-[var(--color-surface)]/95 px-4 py-3 shadow-[var(--shadow-sm)]">
          {!state ? (
            <p className="text-sm text-[var(--color-text-secondary)]">現在地を取得しています…</p>
          ) : state.hasArrived ? (
            // A-8: 「安全な場所に到着しました」等の断定表現は使用しない
            <p className="flex items-center gap-1.5 text-base font-bold text-[var(--color-success)]">
              <SuccessIcon className="h-5 w-5 shrink-0" />
              避難先付近に到着しました
            </p>
          ) : state.nextInstructionJa ? (
            <p className="text-base font-bold text-[var(--color-text-primary)]">
              {formatMeters(state.distanceToNextManeuverMeters)}先 {state.nextInstructionJa}
            </p>
          ) : (
            <p className="text-base font-bold text-[var(--color-text-primary)]">{destinationName}へ向かっています</p>
          )}
          {state?.gpsSignalLost && (
            <p className="mt-1 text-xs text-[var(--color-warning)]">
              現在地の電波状況が良くないようです（直前の位置を表示しています）
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
          <div className="pointer-events-auto">
            <Notice tone="warning" title="参考ルートから外れている可能性があります">
              GPSの誤差の可能性もあります。
              <Button
                onClick={onRecalculate}
                disabled={isRecalculating}
                variant="secondary"
                size="sm"
                fullWidth
                className="mt-2"
              >
                {isRecalculating ? "現在地から再確認しています…" : "現在地からルートを再確認"}
              </Button>
              {recalculateError && <p className="mt-1 text-xs font-normal text-[var(--color-danger)]">{recalculateError}</p>}
            </Notice>
          </div>
        )}

        <div className="pointer-events-auto rounded-[var(--radius-lg)] bg-[var(--color-surface)]/95 px-4 py-3 shadow-[var(--shadow-sm)]">
          <p className="text-sm text-[var(--color-text-primary)]">
            {destinationName} まで残り約{state ? formatMeters(state.distanceRemainingMeters) : "―"}
          </p>
          {/* A-9: ナビ中も参考ルートであることの免責を確認できるようにする */}
          <p className="mt-1 text-[11px] leading-snug text-[var(--color-text-muted)]">
            ※この経路は参考です。冠水・通行止め・倒木・工事・火災・混雑等の実際の道路状況は反映していません。現地の状況を優先してください。
          </p>
        </div>

        <Button onClick={onEnd} variant="secondary" size="md" fullWidth className="pointer-events-auto">
          案内を終了
        </Button>
      </div>
    </>
  );
}
