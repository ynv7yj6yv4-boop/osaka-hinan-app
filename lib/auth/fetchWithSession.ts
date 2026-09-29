// Phase 7: ログイン必須API（/api/region等）をブラウザから呼ぶためのfetch。
//
// Clerkのセッショントークン（Cookie）は短命で、Clerkがバックグラウンドで更新する。
// PWAをバックグラウンドから復帰した直後などは、更新前の古いトークンで
// リクエストしてしまい401になることがある。その場合だけ、Clerk公式の
// session.getToken()でトークンを更新してから1回だけ再試行する
// （独自のトークン・Cookie管理は行わない）。

type ClerkLike = {
  session?: { getToken: (options?: { skipCache?: boolean }) => Promise<string | null> } | null;
};

function getClerk(): ClerkLike | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Clerk?: ClerkLike }).Clerk;
}

export async function fetchWithSession(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status !== 401) return res;
  const session = getClerk()?.session;
  if (!session) return res;
  try {
    await session.getToken({ skipCache: true });
  } catch {
    return res;
  }
  return fetch(input, init);
}

/** 再試行してもログインが確認できない場合に利用者へ出す文言。 */
export const SESSION_EXPIRED_MESSAGE = "ログインの有効期限が切れました。ページを再読み込みして、再度ログインしてください。";
