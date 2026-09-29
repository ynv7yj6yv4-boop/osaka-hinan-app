"use client";

// Phase 7: 登録・ログイン完了時に、Clerkが作成したセッションを有効にしてマップへ移動する。
// signUp.finalize() / signIn.finalize() に渡すnavigateコールバック（Clerk公式の
// custom flowの実装どおり、decorateUrl()を通したURLへ移動する）。

import { AFTER_AUTH_PATH } from "@/lib/auth/authConfig";

type NavigateParams = {
  session?: { currentTask?: unknown } | null;
  decorateUrl: (url: string) => string;
};

/**
 * @param onSessionTask セッションに未完了のタスク（Clerk Dashboardで追加設定を
 *   要求している場合等）が残っている場合に呼ぶ。このアプリでは想定していない。
 */
export function createFinalizeNavigate(onSessionTask: () => void) {
  return async ({ session, decorateUrl }: NavigateParams) => {
    if (session?.currentTask) {
      onSessionTask();
      return;
    }
    const url = decorateUrl(AFTER_AUTH_PATH);
    // 地図ページ（app/page.tsx）はサーバー側で認証を確認するため、新しい
    // セッションCookieで確実にサーバーへ問い合わせるよう、ページ全体を読み込み直す。
    window.location.assign(url);
  };
}

export const SESSION_TASK_MESSAGE =
  "アカウントの設定を完了できませんでした。時間をおいて、もう一度お試しください。";
