// Phase 7: アプリ内のユーザー識別の型（永続化はまだ行わない）。
//
// 【重要】アプリ内部のユーザー識別子には当面ClerkのuserIdを使う。これは
// Firebase Authenticationのuidとは無関係であり、同一とみなしてはならない
// （Clerk→Firebase Authの連携は行っていない）。Firestore等へユーザーデータを
// 保存する場合も、フィールド名は `clerkUserId` のように意味が明確な名前にする。
//
// 将来（次Phase以降）、通知設定・通知対象地域・FCM token・端末情報等を
// このプロフィールへ追加していく想定。

export type ClerkUserId = string;

export type UserProfile = {
  clerkUserId: ClerkUserId;
};
