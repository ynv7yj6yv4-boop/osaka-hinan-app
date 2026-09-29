import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import SignUpForm from "@/components/auth/SignUpForm";
import { APP_NAME } from "@/lib/appInfo";
import { fetchPasswordRequirementText } from "@/lib/auth/passwordPolicy";

export const metadata: Metadata = { title: `アカウントを作成 | ${APP_NAME}` };

// Phase 7: 認証画面は未ログインでも表示できる公開ページ。
// 有効なClerkセッションがある場合は、この画面を出さずにそのままマップへ移動する。
export default async function Page() {
  const { isAuthenticated } = await auth();
  if (isAuthenticated) redirect("/");
  return <SignUpForm passwordRequirementText={await fetchPasswordRequirementText()} />;
}
