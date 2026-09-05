# データソース一覧

このアプリで使用している外部データの出典・ライセンスをまとめます。

## 避難所・避難場所データ

- **出典**: 国土地理院 指定緊急避難場所・指定避難所データ（大阪市, 市町村コード27100）
- **取得元URL**: https://hinanmap.gsi.go.jp/hinanjocp/hinanbasho/koukaidate.html
- **取得日**: 2026-09-06
- **利用規約**: [国土地理院コンテンツ利用規約](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html) に加え、`raw/gsi-notice.txt`（ダウンロード時に同梱される「ご利用上の注意」）に従うこと。特に以下の点に注意：
  - データは最新でない場合がある。最新・詳細は大阪市に確認すること。
  - 「指定緊急避難場所」と「指定避難所」は別物であり、指定緊急避難場所は災害種別ごとに指定される。
  - 第三者に提供する場合は、上記の注意事項を正確に伝えること。
  - → アプリ内の免責表示・データ由来の注記でこれを満たしています。
- **生データ**: `raw/27100_shitei-kinkyu-hinanbasho.csv`（指定緊急避難場所）, `raw/27100_shitei-hinanjo.csv`（指定避難所）
- **変換スクリプト**: `../scripts/build-shelters.mjs` → `../public/data/osaka-shelters.json` を生成

## ハザード情報（洪水・内水氾濫・高潮）

- **出典**: 国土交通省 ハザードマップポータルサイト「重ねるハザードマップ」タイル配信
- **利用規約**: [ハザードマップポータルサイト利用規約](https://disaportal.gsi.go.jp/hazardmap/copyright/copyright.html)（公共データ利用規約PDL1.0準拠。二次利用・商用利用可、出典表記必須、加工した場合はその旨明記）
- **タイルURL**:
  - 洪水浸水想定区域: `https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png`
  - 内水氾濫（大阪府）: `https://disaportaldata.gsi.go.jp/raster/02_naisui_pref_data/27/{z}/{x}/{y}.png`
  - 高潮浸水想定区域: `https://disaportaldata.gsi.go.jp/raster/03_hightide_l2_shinsuishin_data/{z}/{x}/{y}.png`
- アプリ内表示は「出典：ハザードマップポータルサイト」と表記しています。

## 標高データ（現在地の危険度判定・Phase3で使用）

- **出典**: 国土地理院 標高API
- **URL**: `https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php?lat={緯度}&lon={経度}&outtype=JSON`
- **利用規約**: [国土地理院コンテンツ利用規約](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html)（出典表記必須）
- **注意点**: 無料・APIキー不要だが、1秒に1回程度のアクセス制限あり（過度な連続アクセス禁止）。海上等データが無い地点は `elevation` が文字列 `"-----"` で返る。

## ハザードマップの浸水深カラー凡例（Phase3で使用）

- **出典**: 国土交通省の資料に記載された標準凡例。2026-09-06に実際のタイル画像からピクセル色を抽出し、一致することを確認済み。
- 実装: `../lib/hazardColorLegend.ts`

## 現在の降雨実況（Phase4Aで使用）

- **データ提供元**: 気象庁
- **データ名**: 高解像度降水ナウキャスト（実況部分のみ使用。予報部分は今回未使用）
- **取得方法**:
  1. `https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json` で最新の対象時刻（basetime）を取得
  2. `https://www.jma.go.jp/bosai/jmatile/data/nowc/{basetime}/none/{basetime}/surf/hrpns/{z}/{x}/{y}.png`（zoom=10固定）から該当タイル画像を取得
  3. 現在地に対応するピクセルの色を読み取り、`lib/rainfallColorLegend.ts` の対応表と照合
- **データの性質**: レーダー観測による「現在」の推定降水強度（予報ではない）。5分間隔で更新されているとみられる（気象庁の解説記事等で確認したが、厳密な更新間隔の一次資料上の明記は未確認）。
- **⚠️非公式なURLである旨の重要な注記**: 上記URLは、気象庁が開発者向けに公式に提供しているAPIではありません。気象庁ホームページ（「雨雲の動き」ページ）が内部的に使用しているURLを、第三者が技術的に解析して判明したものです。**気象庁の都合により、事前の予告なく仕様変更・提供停止される可能性があります。** 将来この機能が動かなくなった場合は、まずこのURL構造が変更されていないかご確認ください。
- **利用規約**: 気象庁ホームページのコンテンツ全般に適用される「公共データ利用規約」（出典表記必須）は該当すると考えられますが、上記の通り非公式な取得方法である点に留意してください。また、このデータを使って独自の判定（危険度への統合）を行う場合、気象業務法上の「予報業務」に該当しないかは未確認です（Phase4A時点では危険度判定への統合は行っていません）。
- **色→降水強度の変換根拠**: `lib/rainfallColorLegend.ts` のコメントを参照。国交省ハザードマップの色凡例（Phase3）とは異なり、気象庁の一次資料に明記された値ではなく、複数の状況証拠を組み合わせた推定値です。そのため危険度判定には使用せず、目安表示のみに使用しています。
- **実装確認日**: 2026-09-06（実際にタイルを取得し、東京都内の地点で降水検出まで動作確認済み）

## 背景地図

- **出典**: 国土地理院タイル（標準地図） `https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png`
- アプリ内表示は「© 国土地理院」と表記しています。

## データ更新について

避難所データは市町村の登録更新に伴い変わるため、`scripts/build-shelters.mjs` を再実行して定期的に更新することを推奨します（次回以降のPhaseで検討）。
