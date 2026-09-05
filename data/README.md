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

## 徒歩ルート（Phase5Aで使用）

- **データ提供元**: openrouteservice（HeiGIT, ハイデルベルク大学）
- **正式エンドポイント**: `https://api.heigit.org/openrouteservice/v2/directions/{profile}/geojson`（2026-09-06時点で疎通確認済み。古い`api.openrouteservice.org`は使用しない）
- **利用プロファイル**: `foot-walking`（徒歩）
- **代替ルート**: `alternative_routes`パラメータで最大3件取得（openrouteservice側の上限も3）
- **APIキー**: 環境変数 `OPENROUTESERVICE_API_KEY` で管理（`.env.local`、Git管理対象外）。**クライアント側コードには一切埋め込まず**、Next.jsのサーバー側API Route（`app/api/evacuation-route/route.ts`）経由でのみ使用する。
- **利用規約・制限**（[利用規約ページ](https://openrouteservice.org/restrictions/)、2026-09-06に再確認）:
  - 徒歩(foot)プロファイルの通常ルート：距離上限6,000km
  - **`alternative_routes`（複数ルート）使用時：距離上限100km**（通常時より低い。今回の徒歩避難ルート（数百m〜数km）では問題にならない）
  - `alternative_routes`の`target_count`上限：3
  - 経由地点上限：50
  - 無料プランの流量制限（分間・日次のリクエスト数）は同ページに記載があるが、頻繁に変更されうるため実装時点で必ず再確認すること
  - 研究・非商用利用は許容されている
- **道路データ**: OpenStreetMapベース。大阪市内の歩行者経路の網羅性は未検証（今回のテストで確認できた範囲では正常にルートが取得できている）。
- **実装確認日**: 2026-09-06（大阪市北区内で実際にルート取得・複数ルート取得・ハザード評価まで動作確認済み）

## 洪水ハザードによるルート評価（Phase5A / 5A.1 / 5A.2で使用）

- Phase3のハザード判定（`lib/hazardColorLegend.ts`, `lib/tilePixel.ts`）をそのまま再利用。
- 数値計算部分（サンプリング・集計）は `lib/routeHazardMath.ts` に分離し、ネットワークに依存しない単体テスト（`lib/routeHazardMath.test.ts`、`npm test`で実行）で数学的不変条件を検証している。
- I/O（タイル取得）は `lib/routeHazardEvaluation.ts` が担当。
- サンプリング間隔は既定30mだが、呼び出し側で変更可能（`DEFAULT_SAMPLE_INTERVAL_METERS`）。
- 対象は洪水のみ（Phase5A時点）。内水氾濫・高潮はPhase5Bで別途検討。

### 各指標の定義（Phase5A.2で明文化）

| フィールド | 定義 |
|---|---|
| `routingDistanceMeters` | openrouteserviceが報告するルート距離（道路網に基づく正式な距離） |
| `hazardEvaluationDistanceMeters` | このハザード評価が対象とした、ルートgeometryから独自に計算した道なりの総距離。`routingDistanceMeters`とは独立の計算だが、通常0.1%未満の差に収まる（Phase5A.2で実データにより確認） |
| `evaluatedDistanceMeters` | 上記のうち、洪水ハザードの有無を判定できた区間の合計距離 |
| `unavailableDistanceMeters` | 判定できなかった区間の合計距離。「安全」を意味しない |
| `evaluationCoverageRatio` | `evaluatedDistanceMeters / hazardEvaluationDistanceMeters`。ルート全体のうち、使用した洪水ハザードデータで区域内/区域外を判定できた距離の割合 |
| `floodCrossingDistanceMeters` | 評価できた区間のうち、洪水ハザードが検出された区間の合計距離 |
| `floodCrossingRatioAmongEvaluatedDistance` | `floodCrossingDistanceMeters / evaluatedDistanceMeters`。**分母は「評価できた区間」のみ**（ルート総距離ではない） |

いずれも「evaluatedDistanceMeters + unavailableDistanceMeters = hazardEvaluationDistanceMeters」という関係が常に成り立つ（`lib/routeHazardMath.test.ts`で検証）。

### 【重要】Phase5A.2で発見・修正したバグ

Phase5A.1では、サンプル地点どうしの距離を**直線（Haversine）で再計算**していた。これは、道が曲がる区間ではサンプル地点間の直線距離が実際の経路距離より短くなる（コーナーを直線で"ショートカット"してしまう）ため、サンプリング間隔が粗いほど誤差が拡大する不具合だった。

**実データでの確認（L1-Aルート、道なり総距離805m）**:

| 間隔 | 修正前の合計距離 | 修正後の合計距離 |
|---|---:|---:|
| 20m | 769.7m | 804.8m |
| 30m | 759.7m | 804.8m |
| 50m | 747.6m | 804.8m |
| 100m | 728.7m | 804.8m |

修正後は、サンプリング間隔によらず`hazardEvaluationDistanceMeters`がほぼ一定（openrouteserviceの報告距離805.1mとも0.1%未満の差）になることを確認した。

**修正方法**: サンプリング時に頂点間の「道なりの累積距離」を記録し（`RouteSample.cumulativeDistanceMeters`）、サンプル間の距離はこの累積距離の差分から求める（直線距離の再計算はしない）ように変更した。

**この修正が`floodCrossingRatioAmongEvaluatedDistance`（洪水区域割合）に与えた影響は限定的だった**：分子（洪水区域距離）・分母（評価済み距離）の両方が同じ手法（直線再計算）で計算されていたため、比率としては大きくは崩れておらず、40件中の変化は概ね0.1〜1.4ポイント程度だった（詳細は`scripts/research-data/`のbefore(`*.json`/`*.csv`)/after(`*.v2.json`/`*.v2.csv`)を参照）。**影響が大きかったのは「評価カバー率100%」という表示の意味**で、修正前はサンプリングにより短縮された誤った「総距離」に対する100%であり、真のルート距離に対する100%ではなかった。

### 404の意味についての調査結果（Phase5A.2）

洪水ハザードタイルの404について、公式資料・実地点比較調査を行った。

**確認できたこと**：
- ハザードマップポータルサイトの公式ページには「洪水浸水想定区域図を作成している段階の都道府県もあるため、現在、一部の都道府県のデータ配信のみとなっております」との記載があり、**データの整備状況が地域によって異なることは公式に認められている**。
- 実地点比較（2026-09-06実施）で、タイルが存在する（200）地点では、透明ピクセル（alpha=0、区域外）と着色ピクセル（区域内）が同じタイル内に混在することを確認した（例：大阪市北区の座標では、タイルは存在するが該当ピクセルは透明＝確認できた区域外）。これは「区域外」の判定が実際に機能していることの根拠になる。
- 404は「タイル自体が配信されていない」状態であり、透明タイルが返るわけではない。

**確認できなかったこと（判断不能）**：
- 404が「その地点は浸水想定調査の対象河川から外れている（区域外）」を意味するのか、「データが未整備なだけ」を意味するのかは、公式資料から断定できなかった。

**Phase5A.2での対応**：上記を踏まえ、404・通信エラー・色認識失敗はすべて `"unknown"` として扱い、「区域外」とも「評価不能」とも断定せず、`unavailableDistanceMeters` / `evaluationCoverageRatio` に反映することで「このタイルデータだけでは判定できない」状態を明示する設計とした（`SamplePointResult`型を参照）。

### Phase3との整合性についての確認結果

Phase3（`lib/riskAssessment.ts`）は、404相当の状態（`no_tile_data`）を**「区域外の可能性が高いが断定はしない」という文言でスコアに算入**している（rank 0として扱う）。一方Phase5のルート評価は、同じ404相当の状態を**スコア・カバー率の両方から除外する（unknown）**設計になっている。

**この2つの解釈は一致していない。** これはPhase3・Phase5をそれぞれ個別に設計した結果生じた不整合であり、意図した設計差ではない。今回はPhase3のロジックを変更する指示がないため、**この不整合が存在するという事実のみを記録**し、どちらの解釈を正とするか、または用途に応じて使い分けるかは別途方針決定が必要な事項として残す。

### サンプリング間隔比較実験の記録

- **実行日**: 2026-09-06（Phase5A.1で初回実施、Phase5A.2でバグ修正後に再実施）
- **スクリプト**: `scripts/route-sampling-experiment.mjs`（Phase5A.2で本番の`lib/routeHazardMath.ts`を直接importする方式に変更し、ロジックの重複による乖離を防止）
- **結果ファイル**:
  - Phase5A.1時点（バグ修正前）: `scripts/research-data/route-sampling-experiment-results.json` / `.csv`
  - Phase5A.2時点（バグ修正後）: `scripts/research-data/route-sampling-experiment-results.v2.json` / `.v2.csv`
- **条件**: 大阪市内5地点（都心河川近く／湾岸低地／内陸高台寄り／東部低地／南部）、各地点で取得できた徒歩ルート（1〜3件）×サンプリング間隔20/30/50/100mの全組み合わせ、計40件
- **処理時間の計測条件**：`processingTimeMs`はブラウザのHTTPキャッシュ・DNSキャッシュ・OSレベルのキャッシュを制御していない参考値である。並列fetch（Promise.all）はサンプル数によらず同時実行されるため、間隔が粗い（サンプル数が少ない）ほど計測時間が短くなる傾向はアルゴリズムの違いに加えてこれらキャッシュ効果も混在しており、**厳密なアルゴリズム比較には使用できない**。
- **採用間隔**: 今回の実験では確定していない（人間の判断待ち）。「粗い間隔ほど洪水区域通過距離（割合）が増える傾向がある」という以上の結論（例：「20mが真値に最も近い」）は出していない。

## 背景地図

- **出典**: 国土地理院タイル（標準地図） `https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png`
- アプリ内表示は「© 国土地理院」と表記しています。

## データ更新について

避難所データは市町村の登録更新に伴い変わるため、`scripts/build-shelters.mjs` を再実行して定期的に更新することを推奨します（次回以降のPhaseで検討）。
