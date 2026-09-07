// 試作3 PART H: 手動テスト通知（開発者専用エンドポイント）。
//
// 【重要】これはPART F/Gの自動通知判定とは無関係。あくまで
// 「PWA→Service Worker→Firebase→FCM→Vercel→スマートフォン」という
// 経路が正常に機能しているかを、開発者が明示的に1件だけ送って確認する
// ためのものである。一般ユーザーが自由に叩けないよう、環境変数
// TEST_NOTIFICATION_SECRET と一致するヘッダーが無い場合は拒否する。

import { NextResponse } from "next/server";
import { getAdminMessaging } from "@/lib/firebaseAdmin";

export async function POST(request: Request) {
  const secret = process.env.TEST_NOTIFICATION_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "テスト通知機能が設定されていません（TEST_NOTIFICATION_SECRET未設定）" },
      { status: 500 }
    );
  }

  const providedSecret = request.headers.get("x-test-notification-secret");
  if (!providedSecret || providedSecret !== secret) {
    return NextResponse.json({ error: "認証に失敗しました" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストの形式が不正です" }, { status: 400 });
  }

  const { token } = (body ?? {}) as { token?: unknown };
  if (typeof token !== "string" || !token) {
    return NextResponse.json({ error: "token（FCM登録トークン）が必要です" }, { status: 400 });
  }

  try {
    const messaging = getAdminMessaging();
    // PART F-4: これは通知経路の疎通確認用であり、避難を促す実際の通知では
    // ないことが分かる文言にする。
    await messaging.send({
      token,
      notification: {
        title: "テスト通知です",
        body: "これは開発者による手動の疎通確認通知です。実際の災害情報ではありません。",
      },
    });
    return NextResponse.json({ status: "sent" });
  } catch (err) {
    console.error("[test-notification] 送信に失敗しました", err);
    return NextResponse.json(
      {
        error: "通知の送信に失敗しました",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
}
