# Firebase Scheduled Functions（監視ジョブ・技術検証段階）

試作3 次段階 PART 1の実装です。**この`functions/`ディレクトリのデプロイは、
Claude Codeからは実行できません**（Firebase CLIのログイン・請求先アカウントの
確認が必要な操作のため）。以下の手順をご自身で行ってください。

## 前提条件

- Firebaseプロジェクトを **Blazeプラン（従量課金制）** にアップグレードしていること
  - Cloud Functions for Firebase（2nd gen）はSpark（無料）プランでは利用できません
  - ただし、この関数の呼び出し回数（5分に1回 = 月間約8,640回）は
    Blazeプランの無料枠（月200万回まで無料）を大幅に下回るため、
    **想定される実際の課金額は0円です**（Cloud Schedulerジョブも1件のみで、
    無料枠3件以内）
  - アップグレードには支払い方法（クレジットカード等）の登録が必要です
  - 手順: Firebase Console → 左下の「アップグレード」→ Blazeプランを選択

## 初回セットアップ

```bash
# Firebase CLIをインストール（未インストールの場合）
npm install -g firebase-tools

# ブラウザでログイン
firebase login

# このリポジトリのルートディレクトリで実行
cd functions
npm install
```

## デプロイ

```bash
# リポジトリのルートディレクトリで実行
firebase deploy --only functions
```

成功すると、Firebase Console の「Functions」セクションに
`checkMonitoringPoints` という関数が表示され、Cloud Scheduler側にも
対応するジョブ（`firebase-schedule-checkMonitoringPoints-...`）が
自動作成されます。

## 動作確認方法

デプロイ後、Firebase Console → Functions → `checkMonitoringPoints` の
ログを確認してください。5分ごとに以下のようなログが出力されていれば
正常に動作しています。

```
[checkMonitoringPoints] checked=0 candidateCount=0 insufficientDataCount=0 enabled=false decisionVersion=framework-only-v0
```

`checked`の数は、Firestoreの`monitoringPoints`コレクションで
`notificationEnabled: true`になっている件数と一致します。

すぐに確認したい場合は、Firebase Console の該当関数画面から
「今すぐテスト実行」（またはCloud SchedulerコンソールでジョブのRun nowボタン）
を使うと、5分待たずに手動実行できます。

## 【重要】現時点でできていないこと

- 実際の降雨予測・静的ハザード情報の取得はまだ実装していません
  （`../data/README.md`の「Firebase Scheduled Functionsの技術的制約」参照）。
  そのため、`candidateCount`は現状の実装では常に0になります。
- `notificationDecisionConfig.enabled`は`false`のままです。実際の通知は
  一切送信されません。
