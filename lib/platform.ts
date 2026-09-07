// 試作3 PART B-4: iOS/iPadOSで、Safariから直接開いている(ホーム画面に
// 追加していない)かどうかを判定する。
//
// 【重要】iOSは、Push通知の利用条件として「ホーム画面に追加したPWA
// (standalone起動)であること」を要求する（Web Push対応はiOS 16.4以降。
// 詳細はチャット記録・data/README.md参照。二次情報のみでApple公式一次資料
// を直接確認できていない点は要注意）。
// このアプリでは「Safariで開いただけで通知が必ず使える」という前提を
// 置かず、ホーム画面への追加が必要になりうることをユーザーに案内する。

export function isIosSafariNotStandalone(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;

  const ua = navigator.userAgent;
  const isIPhoneOrIPod = /iPhone|iPod/.test(ua);
  // iPadOS 13以降は既定でMacとしてUA偽装するため、タッチ対応で判定する
  const isIPad = /iPad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isIosDevice = isIPhoneOrIPod || isIPad;

  const nav = navigator as Navigator & { standalone?: boolean };
  const isStandalone = nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches;

  return isIosDevice && !isStandalone;
}
