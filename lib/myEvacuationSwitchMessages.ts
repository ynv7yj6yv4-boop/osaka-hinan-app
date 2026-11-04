// マイ避難スイッチの表示文言（UIから切り離した純粋関数。文言方針をテストで固定する）。
//
// 【文言方針】
// - ON時は「高リスクです」ではなく「あなたが平常時に設定した避難開始の目安に達した」ことを伝える。
// - 「必ず避難してください」等の断定的な避難指示にはしない。
// - OFF・目安を下回った場合も「安全です」「安全になりました」とは表示しない。
// - unknownは判定不能として扱い、OFFと同じ表示にしない。
// - 判定のもとは「現在確認している地点」の参考評価であり、「ユーザーが危険」とは表現しない。

import type { MyEvacuationSwitchState, SwitchTransition } from "./myEvacuationSwitch.ts";
import { becameOn } from "./myEvacuationSwitch.ts";

export const MY_EVACUATION_SWITCH_STATE_LABEL: Record<MyEvacuationSwitchState, string> = {
  off: "OFF",
  prepare: "準備",
  on: "ON",
  unknown: "判定できません",
};

export type MyEvacuationSwitchMessage = {
  /** ホーム画面の1行表示・詳細シートの見出し */
  title: string;
  body: string;
  /** 補足（目安を下回った場合の注意等）。無ければnull。 */
  note: string | null;
};

const OFFICIAL_INFO_NOTE = "引き続き自治体・気象庁等の公式情報をご確認ください。";

export function describeMyEvacuationSwitch(
  state: MyEvacuationSwitchState,
  transition: SwitchTransition | null
): MyEvacuationSwitchMessage {
  const lowered = transition?.kind === "lowered";

  switch (state) {
    case "on":
      return {
        title: transition && becameOn(transition) ? "マイ避難スイッチがONになりました" : "マイ避難スイッチ：ON",
        body: "あなたが平常時に設定した避難開始の目安に達しています。",
        note: "避難先・避難ルートと、自治体等の公式の避難情報を確認してください。",
      };
    case "prepare":
      return {
        title: "マイ避難スイッチ：準備",
        body: lowered
          ? "現在の判定では避難開始の目安を下回りましたが、準備の目安には該当しています。"
          : "あなたが設定した「準備」の目安に該当しています。避難先と避難ルートを確認しておきましょう。",
        note: lowered ? OFFICIAL_INFO_NOTE : null,
      };
    case "off":
      return {
        title: "マイ避難スイッチ：OFF",
        body: lowered
          ? transition.from === "on"
            ? "現在の判定では避難開始の目安を下回りました。"
            : "現在の判定では準備の目安を下回りました。"
          : "現在、設定した避難開始の目安には達していません。",
        note: lowered ? OFFICIAL_INFO_NOTE : null,
      };
    case "unknown":
      return {
        title: "マイ避難スイッチ：判定できません",
        body: "現在はマイ避難スイッチの状態を判定できません。",
        note: "災害リスクの情報を取得できませんでした。公式情報をご確認ください。",
      };
  }
}
