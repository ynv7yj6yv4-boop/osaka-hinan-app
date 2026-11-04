// ホーム画面のハンバーガーメニュー（components/AppMenu.tsx）の開閉・画面遷移の状態。
//
// このプロジェクトにはDOMを使うテスト環境（jsdom等）が無いため、
// 「開く・閉じる・Escape・背景クリック・各画面への移動・戻る」の振る舞いを
// UIから切り離した純粋なreducerにし、node --testで直接検証できるようにする。
// UI側はこのreducerの結果どおりに描画するだけにする。

export type AppMenuView = "menu" | "account" | "myEvacuationSwitch" | "notification" | "about";

export type AppMenuState = { open: false } | { open: true; view: AppMenuView };

export type AppMenuAction =
  | { type: "open"; view?: AppMenuView }
  | { type: "close" }
  | { type: "escape" }
  | { type: "backdrop" }
  | { type: "navigate"; view: Exclude<AppMenuView, "menu"> }
  | { type: "back" };

export const INITIAL_APP_MENU_STATE: AppMenuState = { open: false };

export function appMenuReducer(state: AppMenuState, action: AppMenuAction): AppMenuState {
  switch (action.type) {
    case "open":
      return { open: true, view: action.view ?? "menu" };
    case "close":
    case "backdrop":
      return { open: false };
    case "escape":
      // Escapeは「1段戻る」ではなく、メニュー全体を閉じる（Modalと同じ挙動に揃える）。
      return { open: false };
    case "navigate":
      return state.open ? { open: true, view: action.view } : state;
    case "back":
      if (!state.open) return state;
      return state.view === "menu" ? { open: false } : { open: true, view: "menu" };
  }
}

/**
 * フォーカストラップ用: Tab / Shift+Tab で次にフォーカスすべき要素の位置を返す。
 * currentIndexが-1（ドロワー外にフォーカスがある）場合は先頭/末尾へ戻す。
 */
export function nextFocusIndex(currentIndex: number, count: number, shiftKey: boolean): number {
  if (count <= 0) return -1;
  if (currentIndex < 0) return shiftKey ? count - 1 : 0;
  if (shiftKey) return currentIndex === 0 ? count - 1 : currentIndex - 1;
  return currentIndex === count - 1 ? 0 : currentIndex + 1;
}
