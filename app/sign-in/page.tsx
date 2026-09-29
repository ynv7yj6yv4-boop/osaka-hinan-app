import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import SignInForm from "@/components/auth/SignInForm";
import { APP_NAME } from "@/lib/appInfo";

export const metadata: Metadata = { title: `ログイン | ${APP_NAME}` };

// Phase 7: 認証画面は未ログインでも表示できる公開ページ。
// 有効なClerkセッションがある場合は、この画面を出さずにそのままマップへ移動する。
export default async function Page() {
  const { isAuthenticated } = await auth();
  if (isAuthenticated) redirect("/");
  return <SignInForm />;
}
