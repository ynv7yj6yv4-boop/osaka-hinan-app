// Phase 7: Route Handler（API）でClerkのログインを要求するための共通処理。
//
// 【auth.protect()を使わない理由】auth.protect()は未ログインのAPIリクエストに
// 404を返す仕様のため、クライアント側で「未ログイン」と「存在しない」を区別
// できない。APIでは明示的に401と日本語メッセージを返す。

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import type { ClerkUserId } from "./userProfile";

export type ApiAuthResult =
  | { ok: true; clerkUserId: ClerkUserId }
  | { ok: false; response: NextResponse };

export async function requireApiAuth(): Promise<ApiAuthResult> {
  const { isAuthenticated, userId } = await auth();
  if (!isAuthenticated || !userId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "ログインが必要です。再度ログインしてください。" },
        { status: 401 }
      ),
    };
  }
  return { ok: true, clerkUserId: userId };
}
