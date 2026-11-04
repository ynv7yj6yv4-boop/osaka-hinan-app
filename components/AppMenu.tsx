"use client";

// ホーム画面のハンバーガーメニュー（☰）。以前ヘッダーに単独で置いていた
// アカウントメニュー（Phase 7）をこの中の「アカウント」へ統合し、
// マイ避難スイッチ・通知設定・このアプリについてを並べる。
// Clerkのユーザー情報・ログアウトはcomponents/AccountMenu.tsx（AccountDetails）が担い、
// ここではその中に「この端末の利用状況」を差し込むだけにする。
//
// 開閉・画面遷移の状態はlib/menu/appMenuState.tsのreducerで管理し（MapViewが保持）、
// ここは描画のみを担う。縦向きのヘッダー用と横向きの浮動ボタン用の2つの☰ボタンが
// 同じDrawerを開く。
//
// 【重要・データ方針】
// - アカウント情報はClerkのユーザー情報（メールアドレス）を表示するだけで、アプリ側では保存しない。
// - 通知地点はClerkアカウントではなく「この端末の通知トークン」に紐づいている（userIdとの
//   紐付けは未実装）ため、その事実どおりに「この端末で登録」と表示する。
// - マイ避難スイッチの設定はこの端末のlocalStorageのみに保存する（アカウントには同期しない）。

import { useEffect, useId, useState, type Dispatch } from "react";
import {
  fetchMonitoringPoint,
  getSavedMonitoringPointId,
  getSavedMonitoringPointToken,
  type MonitoringPointInfo,
} from "@/lib/monitoringPoints";
import type { AppMenuAction, AppMenuState, AppMenuView } from "@/lib/menu/appMenuState";
import { MY_EVACUATION_SWITCH_STATE_LABEL } from "@/lib/myEvacuationSwitchMessages";
import { APP_NAME, APP_TARGET_PREFECTURES_TEXT } from "@/lib/appInfo";
import Drawer from "./ui/Drawer";
import ToggleSwitch from "./ui/ToggleSwitch";
import AccountDetails, { AccountInfoItem } from "./AccountMenu";
import MonitoringPointSection from "./MonitoringPointSection";
import { criteriaText, type MyEvacuationSwitchStatusValue } from "./MyEvacuationSwitchStatus";
import { MenuIcon, ChevronLeftIcon, ChevronDownIcon } from "./ui/icons";

const VIEW_TITLE: Record<AppMenuView, string> = {
  menu: "メニュー",
  account: "アカウント",
  myEvacuationSwitch: "マイ避難スイッチ",
  notification: "通知設定",
  about: "このアプリについて",
};

/**
 * variant:
 * - "header"（既定）: 縦向きのヘッダー内に、情報アイコンと並べる
 * - "floating": 横向き（ヘッダー非表示）のとき、地図の上に単独で浮かせる丸いボタン
 */
export function AppMenuButton({
  variant = "header",
  expanded,
  onOpen,
}: {
  variant?: "header" | "floating";
  expanded: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      aria-label="メニューを開く"
      className={
        variant === "floating"
          ? "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/95 text-[var(--color-text-secondary)] shadow-[var(--shadow-sm)]"
          : // 縦向きヘッダーの高さ（2行分）は変えずに、タップ領域だけ44px確保する。
            "-my-1.5 -mr-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--color-text-secondary)]"
      }
    >
      <MenuIcon className="h-6 w-6" />
    </button>
  );
}

type SwitchProps = {
  switchEnabled: boolean;
  onSwitchEnabledChange: (enabled: boolean) => void;
  switchStatus: MyEvacuationSwitchStatusValue | null;
  /** localStorageへ保存できなかった場合true（画面上の設定はこのまま使える）。 */
  switchSaveFailed: boolean;
};

export function AppMenuDrawer({
  state,
  dispatch,
  position,
  ...switchProps
}: SwitchProps & {
  state: AppMenuState;
  dispatch: Dispatch<AppMenuAction>;
  position: { lat: number; lng: number } | null;
}) {
  const titleId = useId();
  if (!state.open) return null;
  const view = state.view;

  return (
    <Drawer
      title={VIEW_TITLE[view]}
      titleId={titleId}
      focusKey={view}
      onClose={() => dispatch({ type: "close" })}
      onBackdropClick={() => dispatch({ type: "backdrop" })}
      onEscape={() => dispatch({ type: "escape" })}
      leading={
        view !== "menu" ? (
          <button
            type="button"
            onClick={() => dispatch({ type: "back" })}
            aria-label="メニューに戻る"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)]"
          >
            <ChevronLeftIcon className="h-5 w-5" />
          </button>
        ) : undefined
      }
    >
      {view === "menu" && <MenuList dispatch={dispatch} {...switchProps} />}
      {view === "account" && <AccountView {...switchProps} />}
      {view === "myEvacuationSwitch" && <MyEvacuationSwitchSettingsView {...switchProps} />}
      {view === "notification" && <NotificationView position={position} />}
      {view === "about" && <AboutView />}
    </Drawer>
  );
}

function MenuRow({ label, description, onClick }: { label: string; description?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-12 w-full items-center gap-2 px-1 py-2 text-left hover:bg-[var(--color-surface-subtle)]"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-base font-bold text-[var(--color-text-primary)]">{label}</span>
        {description && <span className="block text-xs leading-snug text-[var(--color-text-muted)]">{description}</span>}
      </span>
      <ChevronDownIcon className="h-4 w-4 shrink-0 -rotate-90 text-[var(--color-text-muted)]" />
    </button>
  );
}

function MenuList({ dispatch, switchEnabled, onSwitchEnabledChange, switchSaveFailed }: SwitchProps & { dispatch: Dispatch<AppMenuAction> }) {
  return (
    <>
      <ul className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
        <li>
          <MenuRow label="アカウント" description="ログイン情報・この端末の利用状況" onClick={() => dispatch({ type: "navigate", view: "account" })} />
        </li>
        <li className="flex items-center gap-2">
          {/* 行の左側（名前）で設定画面へ、右側のスイッチで機能の有効/無効を切り替える。 */}
          <div className="min-w-0 flex-1">
            <MenuRow
              label="マイ避難スイッチ"
              description="避難開始の目安を再確認"
              onClick={() => dispatch({ type: "navigate", view: "myEvacuationSwitch" })}
            />
          </div>
          <ToggleSwitch checked={switchEnabled} onChange={onSwitchEnabledChange} label="マイ避難スイッチ" />
        </li>
        <li>
          <MenuRow label="通知設定" description="この場所の災害リスク通知（試作機能）" onClick={() => dispatch({ type: "navigate", view: "notification" })} />
        </li>
        <li>
          <MenuRow label="このアプリについて" onClick={() => dispatch({ type: "navigate", view: "about" })} />
        </li>
      </ul>
      <SaveFailedNote show={switchSaveFailed} />
    </>
  );
}

function SaveFailedNote({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p role="status" className="mt-3 text-xs leading-snug text-[var(--color-warning)]">
      この端末に設定を保存できませんでした（プライベートブラウズ等）。アプリを再読み込みすると、設定が元に戻ります。
    </p>
  );
}

function notificationPermissionText(): string {
  if (typeof window === "undefined" || !("Notification" in window)) return "この端末・ブラウザでは利用できません";
  switch (Notification.permission) {
    case "granted":
      return "許可済み";
    case "denied":
      return "許可されていません";
    default:
      return "まだ設定していません";
  }
}

type PointLookup = { status: "none" } | { status: "loading" } | { status: "found"; info: MonitoringPointInfo } | { status: "error" };

/** この端末で登録した通知地点（最大1件）を確認する。通知許可プロンプトは出さない。 */
function useSavedMonitoringPoint(): PointLookup {
  const [lookup, setLookup] = useState<PointLookup>(() =>
    getSavedMonitoringPointId() && getSavedMonitoringPointToken() ? { status: "loading" } : { status: "none" }
  );
  useEffect(() => {
    const id = getSavedMonitoringPointId();
    const token = getSavedMonitoringPointToken();
    if (!id || !token) return;
    let cancelled = false;
    fetchMonitoringPoint(id, token).then((info) => {
      if (cancelled) return;
      setLookup(info ? { status: "found", info } : { status: "error" });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return lookup;
}

function AccountView({ switchEnabled, switchStatus }: SwitchProps) {
  const point = useSavedMonitoringPoint();

  const pointText =
    point.status === "none"
      ? "0件"
      : point.status === "loading"
        ? "（確認中）"
        : point.status === "found"
          ? "1件"
          : "確認できませんでした";
  const pointNotificationText =
    point.status === "found" ? (point.info.notificationEnabled ? "受け取る" : "停止中") : point.status === "none" ? "登録地点なし" : "―";

  const switchText = !switchEnabled
    ? "無効"
    : switchStatus
      ? `有効（現在の状態：${MY_EVACUATION_SWITCH_STATE_LABEL[switchStatus.state]}）`
      : "有効（現在地を確認すると状態を表示します）";

  return (
    <AccountDetails>
      <section className="mt-4">
        <h3 className="text-sm font-bold text-[var(--color-text-secondary)]">この端末の利用状況</h3>
        <dl className="divide-y divide-[var(--color-border)]">
          <AccountInfoItem
            label="通知地点（この端末で登録）"
            value={pointText}
            note="通知地点は、現在はアカウントではなくこの端末に紐づいています。"
          />
          <AccountInfoItem label="通知地点の通知" value={pointNotificationText} />
          <AccountInfoItem label="この端末の通知許可" value={notificationPermissionText()} />
          <AccountInfoItem label="マイ避難スイッチ" value={switchText} note="この設定はこの端末に保存され、アカウントには同期されません。" />
        </dl>
      </section>
    </AccountDetails>
  );
}

function MyEvacuationSwitchSettingsView({ switchEnabled, onSwitchEnabledChange, switchStatus, switchSaveFailed }: SwitchProps) {
  const criteria = criteriaText();
  return (
    <>
      <section className="rounded-[var(--radius-md)] bg-[var(--color-primary-surface)] p-3.5">
        <h3 className="text-base font-bold text-[var(--color-text-primary)]">マイ避難スイッチとは？</h3>
        <p className="mt-1 text-sm leading-relaxed text-[var(--color-text-primary)]">
          平常時に決めた避難開始の目安を、災害時に再確認するための機能です。
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-text-secondary)]">
          災害時は「まだ大丈夫」と感じて判断を先延ばしにしがちです。落ち着いている今のうちに目安を決めておき、その目安に達したときに、あなたが決めた基準をもう一度お知らせします。
        </p>
      </section>

      <div className="mt-4 flex items-center justify-between gap-3 rounded-[var(--radius-md)] border-2 border-[var(--color-border)] px-3.5 py-2">
        <span className="text-base font-bold text-[var(--color-text-primary)]">この目安でマイ避難スイッチを使う</span>
        <ToggleSwitch checked={switchEnabled} onChange={onSwitchEnabledChange} label="マイ避難スイッチ" />
      </div>
      <SaveFailedNote show={switchSaveFailed} />
      {switchEnabled && (
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          現在の状態：
          <span className="font-bold text-[var(--color-text-primary)]">
            {switchStatus ? MY_EVACUATION_SWITCH_STATE_LABEL[switchStatus.state] : "現在地を確認すると表示します"}
          </span>
        </p>
      )}

      <section className="mt-4">
        <h3 className="text-sm font-bold text-[var(--color-text-secondary)]">避難開始の目安</h3>
        <dl className="mt-1 divide-y divide-[var(--color-border)] text-sm">
          <div className="py-2">
            <dt className="font-bold text-[var(--color-text-primary)]">準備</dt>
            <dd className="text-[var(--color-text-secondary)]">{criteria.prepare}のとき。避難先と避難ルートを確認しておく目安です。</dd>
          </div>
          <div className="py-2">
            <dt className="font-bold text-[var(--color-text-primary)]">ON</dt>
            <dd className="text-[var(--color-text-secondary)]">{criteria.on}のとき。避難を始める目安です。</dd>
          </div>
          <div className="py-2">
            <dt className="font-bold text-[var(--color-text-primary)]">判定できません</dt>
            <dd className="text-[var(--color-text-secondary)]">災害リスクの情報を取得できなかったとき。OFFとは扱いません。</dd>
          </div>
        </dl>
        <p className="mt-1 text-xs leading-snug text-[var(--color-text-muted)]">※目安を自分で選べる機能は今後対応予定です。</p>
      </section>

      <section className="mt-4 border-t border-[var(--color-border)] pt-3 text-xs leading-relaxed text-[var(--color-text-muted)]">
        <p>※判定に使う災害リスクは、現在確認している地点の浸水想定区域と、今後24時間の予想雨量に基づく参考評価です。予想雨量を取得できなかった場合は浸水想定のみで判定するため、雨が予想されていなくてもONと表示される場合があります。</p>
        <p className="mt-1">※自治体が発令する避難情報ではありません。公式の避難情報も必ずご確認ください。</p>
        <p className="mt-1">※無効にしても、通常の災害リスク表示や公式情報はそのまま表示されます。</p>
        <p className="mt-1">※この設定はこの端末にのみ保存されます。位置情報は保存しません。</p>
      </section>
    </>
  );
}

function NotificationView({ position }: { position: { lat: number; lng: number } | null }) {
  if (!position) {
    return (
      <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
        通知地点を登録するには、先にホーム画面で現在地を取得してください。
      </p>
    );
  }
  // 既存の通知地点登録UI（RiskDetailModal内と同じコンポーネント）をそのまま再利用する。
  return <MonitoringPointSection position={position} />;
}

function AboutView() {
  return (
    <div className="space-y-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
      <p className="text-base font-bold text-[var(--color-text-primary)]">{APP_NAME}</p>
      <p>
        近畿2府4県（{APP_TARGET_PREFECTURES_TEXT}）を対象に、洪水時の避難先候補・参考避難ルート・現在地の洪水ハザード情報を確認できる研究用の試作アプリです。
      </p>
      <p>
        ※本アプリは参考情報です。公式情報も必ずご確認ください。災害種別は洪水のみを扱います。対象地域外では情報が不正確な場合があります。
      </p>
    </div>
  );
}
