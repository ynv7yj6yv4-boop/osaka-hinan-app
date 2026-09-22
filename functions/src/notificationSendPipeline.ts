// 要件定義書4 §2・§5.5・§8: 送信可否判定(判定ロジック)と送信処理(FCM実送信)を
// 分離した独立関数。判定ロジック(notificationDecision.ts)には一切変更を加えない。
//
// 【重要・不変条件】この関数の入口で
// 「decision.type === "candidate" かつ configEnabled === true」を確認してから
// でなければ sendFn を一切呼ばない。判定ロジック側にも同じ多重防御があるが
// (config.enabled=falseならcandidateを返さない)、ここでも独立に確認することで
// 二重に保護する。単体テストではこの入口の分岐そのものを検証する
// (sendFnをモックし、呼ばれた回数で不変条件を保証する)。
//
// 送信を試みなかった場合(no_notification/insufficient_data/cooldown、または
// enabled=false)は cooldownUpdate は必ず null。送信に成功した場合のみ
// cooldownUpdate を返す(要件定義書4 §5.6)。

import type { NotificationDecisionResult } from "./notificationDecision";
import type { FcmSendResult } from "./fcmSender";

export type CandidateSendOutcome = {
  sendAttempted: boolean;
  sendResult: "success" | "failed" | null;
  sendErrorCode: string | null;
  autoDisabledPoint: boolean;
  cooldownUpdate: { lastNotifiedAt: string; lastNotificationState: "sent" } | null;
  /** falseへの変更が必要な場合のみfalse。それ以外(変更不要)はnull。 */
  notificationEnabledUpdate: false | null;
};

const NO_SEND_OUTCOME: CandidateSendOutcome = {
  sendAttempted: false,
  sendResult: null,
  sendErrorCode: null,
  autoDisabledPoint: false,
  cooldownUpdate: null,
  notificationEnabledUpdate: null,
};

export async function processCandidateSend(
  decision: NotificationDecisionResult,
  configEnabled: boolean,
  fcmToken: string,
  now: Date,
  sendFn: (token: string, notification: { title: string; body: string }) => Promise<FcmSendResult>,
  notification: { title: string; body: string }
): Promise<CandidateSendOutcome> {
  // 【最重要・多重防御】ここを通過しない限りsendFnは呼ばれない。
  if (decision.type !== "candidate" || !configEnabled) {
    return NO_SEND_OUTCOME;
  }

  const result = await sendFn(fcmToken, notification);

  if (result.ok) {
    return {
      sendAttempted: true,
      sendResult: "success",
      sendErrorCode: null,
      autoDisabledPoint: false,
      cooldownUpdate: { lastNotifiedAt: now.toISOString(), lastNotificationState: "sent" },
      notificationEnabledUpdate: null,
    };
  }

  return {
    sendAttempted: true,
    sendResult: "failed",
    sendErrorCode: result.errorCode,
    autoDisabledPoint: result.permanent,
    cooldownUpdate: null,
    notificationEnabledUpdate: result.permanent ? false : null,
  };
}
