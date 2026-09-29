import { auth } from "@clerk/nextjs/server";
import MapViewLoader from "@/components/MapViewLoader";

// Phase 7: 避難支援マップはログイン必須。
// 認証状態はサーバー側で確定させてから描画するため、クライアント側で
// 「一瞬マップ→サインイン画面」のような画面の切り替わりは起きない。
// 有効なClerkセッションがあれば（再読み込み・PWA再起動後も）そのままマップを表示する。
export default async function Home() {
  const { isAuthenticated, redirectToSignIn } = await auth();
  if (!isAuthenticated) return redirectToSignIn();
  return <MapViewLoader />;
}
