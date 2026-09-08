# データソース一覧

このアプリで使用している外部データの出典・ライセンスをまとめます。

## MVPバージョン

**`mvp-v1.0`**（Phase6.1完了時点、2026-09-06）

卒業研究の実験・デモに使用するバージョンとしてこの時点のコードを基準とする。
以降、機能追加は原則停止し、バグ修正・実験に必要な最小限の修正のみ行う方針。
対応するコミットは以下のgit historyを参照（可能であれば同名のgit tagも付与）。

## Phase6.1（MVP最終リリース監査）について

Phase6.1では新機能追加は行わず、以下2点の監査・最小限の修正のみ行った。

### 1. 洪水ルート機能の誤適用防止

現在地の危険度が高潮・内水氾濫主導（洪水は`outside`または`unknown`）の場合、
「避難先を探す」機能がその危険度に対応しているかのように誤認されないよう、
以下を修正した。

- ボタン文言を「避難先を探す（洪水対応）」→「洪水時の避難先候補を見る」に変更（常に洪水限定であることを明示）
- 高潮・内水氾濫が主な危険度の原因である場合、ボタンを押す**前**に警告
  （「現在の危険度は主に高潮・内水氾濫によるものです。下記の参考避難ルート機能は
  洪水のみに対応しており、現在の危険度には対応していません。」）を表示し、
  ボタンの見た目も控えめな配色に変更（機能自体は非表示にしていない）
- `EvacuationPanel`のルート一覧の見出しも「参考避難ルート」→「洪水の参考避難ルート」に変更

洪水ルート機能そのもの（対象は洪水のみ）は変更していない。

### 2. 大阪市域チェックの監査・修正

Phase6の`isLikelyOutsideOsakaArea()`は、緩い矩形の**外側**の場合のみ案内を表示し、
**内側**の場合は何も表示しない設計だった。しかし、豊中市役所（34.7815, 135.4696）・
堺市役所（34.5733, 135.4830）など、大阪市**ではない**近隣自治体の地点も、
この緩い矩形には含まれてしまうことを実際に確認した（実装バグではなく、
行政区域データを持たないことによる構造的な限界）。

**修正**: `lib/osakaAreaCheck.ts`の`checkOsakaArea()`が3値相当の判定
（`clearly_outside` / `likely_osaka_or_nearby`）を返すようにし、
`likely_osaka_or_nearby`（矩形内）の場合も「大阪市内である」と断定せず、
常に「現在のMVPは大阪市を対象としています。大阪市外の場合、表示される情報が
正しくない可能性があります。」という控えめな案内を表示するようにした。
矩形の外側（`clearly_outside`）の場合はより明確な警告を表示する。

**重要**: `checkOsakaArea()`はあくまで「大阪市周辺かどうかを見るための簡易チェック」
であり、行政区域を正確に判定するものではない。`likely_osaka_or_nearby`は
「矩形内＝大阪市内」を意味しない。

### 研究用テスト地点との違い

上記の`checkOsakaArea()`は、一般利用者が任意の場所でアプリを開いた場合の
簡易的な目安表示のために存在する。卒業研究の実験では、これとは別に、
**研究者が事前に大阪市内であることを確認済みの座標**（例:
`scripts/route-sampling-experiment.mjs`で使用した5地点）を直接指定して使用する。
実験で使用する地点は、この簡易チェックの結果に依存しない。

## Phase6（大阪市版MVP統合）について

Phase6では新しい判定ロジックの追加は行わず、Phase3〜5A.3で作成した機能を
一連のユーザーフロー（現在地取得→災害リスク確認→理由確認→避難先探索→
ルート比較→地図確認）として統合し、UI/UXを整理した。

- 新規: `components/IntroPanel.tsx`（現在地取得前の案内）、`lib/osakaAreaCheck.ts`
  （大阪市を十分に囲む緩い矩形での簡易チェック。行政区域の推測判定は行わない）
- 変更: `components/MapView.tsx`（画面全体の統合・エラー分岐・大阪市域外案内）、
  `components/RiskCard.tsx`（partial時のバッジ追加）、
  `components/RiskDetailModal.tsx`（判定状況セクション追加）、
  `components/EvacuationPanel.tsx`（ローディング分離・戻る導線・Coverage0%表現の修正）
- Phase3の静的ハザード判定、Phase4Aの降雨取得、Phase5Aのルート評価
  （距離計算・サンプリング・openrouteservice呼び出し・RouteJudgmentLogの数式）は
  一切変更していない（回帰テスト`npm test`で確認）。

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

## 洪水ハザードによるルート評価（Phase5A / 5A.1 / 5A.2 / 5A.3で使用）

- タイルの取得・判定（hazard/outside/unknown）は `lib/hazardPixelClassifier.ts` に共通化し、Phase3（`lib/riskAssessment.ts`）とPhase5（`lib/routeHazardEvaluation.ts`）の両方がこれを使う（Phase5A.3、回帰テストは`lib/hazardPixelClassifier.test.ts`）。
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

### Phase3とPhase5の判定状態の統一（Phase5A.3で解消）

Phase5A.2の監査で、Phase3（`lib/riskAssessment.ts`）は404相当の状態（`no_tile_data`）を「区域外の可能性が高いが断定はしない」という文言でスコアに算入していた（rank 0として扱っていた）のに対し、Phase5のルート評価は同じ404相当の状態をスコア・カバー率の両方から除外する（unknown）設計になっており、**両者の解釈が一致していない**ことが判明していた。

**Phase5A.3でこの不整合を解消した。** 方針は「Phase5側の保守的な解釈に統一する」こと。具体的には、タイル取得結果の解釈を`lib/hazardPixelClassifier.ts`という共通モジュールに切り出し、Phase3・Phase5の両方がこれを使うように変更した。

#### 共通化した判定状態

| status | 意味 | 条件 |
|---|---|---|
| `hazard` | ハザード想定区域内 | タイル取得成功・凡例と一致する色を検出 |
| `outside` | 確認できた区域外 | タイル取得成功・透明ピクセル（alpha=0） |
| `unknown`（reason: `no_tile`） | 判定できない | タイルが404で存在しない |
| `unknown`（reason: `fetch_error`） | 判定できない | 通信エラー・画像デコード失敗等 |
| `unknown`（reason: `color_unknown`） | 判定できない | ピクセルは取得できたが凡例と一致しない |

**`outside`と`unknown`の違い**：`outside`は「タイルというデータソース自体は存在し、そのデータに基づいて区域外と確認できた」状態。`unknown`は「そもそも判定材料となるデータが得られなかった」状態。前者は積極的な確認結果、後者はデータの欠如であり、両者は明確に異なる確度を持つ。

**404を区域外と解釈しない理由**：ハザードマップポータルサイトの公式資料からは、404が「区域外（浸水想定調査の対象河川から外れている）」を意味するのか「データが未整備なだけ」を意味するのかを断定できなかった（詳細は次項）。断定できない以上、どちらか一方に決め打ちすることは、実際にはリスクがある地点を「安全」と誤って伝えるおそれがあるため、保守的に`unknown`として扱う。

#### 判定の完全性（assessmentCompleteness）

Phase3の危険度判定に、洪水・内水氾濫・高潮のうち何件を実際に判定できたかを示す`assessmentCompleteness`を追加した。

| 値 | 意味 |
|---|---|
| `complete` | 3種類すべて判定成功（hazardまたはoutside） |
| `partial` | 一部のみ判定成功、残りはunknown |
| `unavailable` | すべてunknown |

**重要**: `partial`の場合でも、判定できたハザードの情報だけで危険度（level）を算出し、unknownの存在によって既知のリスクを引き下げない（例：洪水が判定不可でも、高潮の想定浸水深に基づく危険度は維持される）。`unavailable`の場合のみ、危険度は`unknown`（🟢「低リスク」ではなく⚪「判定情報不足」）になる。これにより、山間部等ですべてのハザードがunknownになったケースで、誤って🟢を表示する問題（Phase3の初期実装で発生していた）を修正した。

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

---

# 試作3（要件定義書2以降）で判明・追加した内容

## openrouteserviceの案内情報(instructions)・言語対応の検証結果

- **確認日**: 2026-09-08
- 現在使用中のリクエスト内容（`instructions`パラメータを指定しない）でも、
  ORSはデフォルトで`properties.segments[0].steps`（曲がり方コード`type`・
  `instruction`(英語)・`distance`・`duration`・`name`・`way_points`）を返す
  ことを実際のAPI呼び出しで確認済み。リクエスト内容の変更は不要だった。
- **`language: "ja"`パラメータは実際には使用できない**。実際にAPIへ
  問い合わせたところ、このパラメータを付けると502エラーになった。
  ORS公式のOpenAPI仕様（Languages enum）を検索した限りでも日本語は
  列挙されておらず、「日本語対応済み」とする一部の二次情報は誤りの
  可能性が高い（対応状況を推測しないという方針に基づき、実地検証の結果を
  優先した）。
- 曲がり方コード(`type`, 0〜13)の意味は、ORS公式ドキュメント
  （https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/instruction-types ）
  で確認済み。この数値コードと`name`（道路名。OSMデータのため日本語の
  場合が多い）・`distance`を組み合わせ、日本語の案内文を独自に組み立てる
  方式を採用した（`lib/navigation.ts`の`describeStep()`）。

## 降雨予測データ（高解像度降水ナウキャスト予測, N2系列）の発見

- **確認日**: 2026-09-07
- Phase4Aの実況取得で使用している`targetTimes_N1.json`は実況のみ
  （`basetime`＝`validtime`、過去方向にのみ並ぶ）だが、隣接する
  `https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N2.json`
  を実際に取得したところ、`basetime`（実況の最新時刻）を固定したまま、
  `validtime`が5分刻みで60分先まで進む12件のエントリが確認できた。
  タイルURLの構造（`/{basetime}/none/{validtime}/surf/hrpns/...`）は
  実況と同じで、`validtime`部分だけを差し替える形になっている。
- 気象庁の解説にある「高解像度降水ナウキャスト（予測）：30分先までの
  5分毎予測」に対応する系列と考えられるが、この対応関係自体は状況証拠
  であり、気象庁の一次資料による確認ではない。
- **実況と同じ限界を引き継ぐ**：非公式URL（予告なき変更・停止のリスク）、
  色→mm/hの対応が一次資料で完全確認できていない、という2点は実況と同一。
  加えて「予測」であるため、外れる可能性がある。
- 実装は`lib/rainfallForecast.ts`（実況の`lib/rainfallObservation.ts`とは
  完全に別モジュール。要件定義書2 PART F-2の方針どおり）。
- より公式性の高い「降水短時間予報」（1km解像度・最大15時間先）は、
  気象業務支援センター(JMBSC)経由の有償契約が必要な可能性が高く、
  今回は技術的な利用可否を検証できていない。

## 気象庁「雨の強さと降り方」表（通知判定の検討材料）

- **出典**: 気象庁公式サイト（https://www.jma.go.jp/jma/kishou/know/yougo_hp/amehyo.html ）
- 10〜20mm/h未満: やや強い雨／20〜30mm/h未満: 強い雨／
  30〜50mm/h未満: 激しい雨／50〜80mm/h未満: 非常に激しい雨／
  80mm/h以上: 猛烈な雨
- `lib/rainfallColorLegend.ts`のrank4〜8は、この公式区分と対応するように
  作成されている（ただし色→mm/hの対応自体は上記のとおり状況証拠であり、
  一次資料による確認ではない点に注意）。
- この表は「雨の強さの一般的な区分」であり、「この強さになったら避難通知
  を送るべき」という基準を気象庁が示しているわけではない。通知の閾値
  そのものの根拠には使えない（PART4比較報告参照）。

## ナビゲーションの逸脱・到着判定閾値（暫定値・未検証）

`lib/navigation.ts`で使用している以下の値は、**実地テスト前の暫定設定値**
であり、「検証済みの最適値」ではない。

- `OFF_ROUTE_BASE_METERS = 30`（逸脱判定の基準距離）
- `OFF_ROUTE_ACCURACY_MULTIPLIER = 1.5`（GPS精度に応じた倍率）
- `OFF_ROUTE_CONSECUTIVE_READINGS = 3`（連続何回で逸脱扱いにするか）
- `ARRIVAL_BASE_METERS = 30`（到着判定の基準距離）

実地テストで、以下を確認してから確定させること。

1. 正しくルート上を歩いているのに逸脱扱いされないか
2. 実際に道を外れたとき、適切なタイミングで検出できるか
3. 建物の多い場所でGPS誤差がどう影響するか

## 通知判定フレームワーク（notificationDecision）の安全設計

- `lib/notificationDecisionConfig.ts`の`enabled: false`が、実際の自動通知
  送信を止める「総本山スイッチ」。この値がfalseである限り、
  `lib/notificationDecision.ts`の`evaluateNotificationDecision()`は
  どのような入力に対しても`"candidate"`を返さない（多重防御。
  `lib/notificationDecision.test.ts`で検証済み）。
- 現在の`rainfallRankThreshold`・`hazardDepthRankThreshold`・
  `cooldownMinutes`は、いずれも**研究用に比較検討している候補値**であり、
  公的資料による裏付けが不十分なため`enabled`はfalseのまま維持している。

## 洪水ハザードマップの想定降雨条件（重要な構造的制約）

- **確認日**: 2026-09-08
- 洪水浸水想定区域図(L2, 想定最大規模)の想定降雨は、国土交通省の技術基準
  「浸水想定(洪水、内水)の作成等のための想定最大外力の設定手法」(2015年7月)
  https://www.mlit.go.jp/river/shishin_guideline/pdf/shinsuisoutei_honnbun_1507.pdf
  に基づき、全国を降雨特性の似た**15地域に区分**した上で、**河川の流域面積・
  降雨継続時間（河川の洪水到達時間等を参考に設定）ごと**に定められている。
- 大阪府は**154の府管理河川それぞれについて個別に**浸水想定区域図を公表
  （https://www.pref.osaka.lg.jp/kasenseibi/keikaku/kozuishinso.html ）。
  大阪市管理河川も別途公表されている
  （https://www.city.osaka.lg.jp/kensetsu/page/0000675084.html ）。
  想定最大規模・計画規模双方の浸水深、浸水継続時間等が河川ごとに示される。
- **【重要な結論】** 現在アプリが使用しているハザードタイル
  (`disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data`)は、
  これら多数の河川の個別の浸水想定区域図を1枚のタイルに合成したものであり、
  **タイルの色(浸水深ランク)だけからは、その地点がどの河川の、どの想定降雨
  条件（総雨量・継続時間）に基づく区域なのかを機械的に逆引きできない。**
  大阪市全体で単一の想定降雨量が存在するわけではなく、河川ごとに異なりうる。
- この制約により、`lib/rainfallAssumption.ts`の
  `compareRainfallToAssumption()`は、現時点では実質的に常に
  `not_comparable`（reason: `assumption_unavailable`）を返す。将来、
  河川名・想定降雨条件を紐づけたGISデータを別途入手できれば解消しうる。

## 降雨予測データの追加候補：Open-Meteo経由のJMA MSM

- **確認日**: 2026-09-08（実際にAPIへ問い合わせ、大阪市役所付近で48時間分の
  時間雨量予測・24時間積算32.2mmの取得まで動作確認済み）
- **データ提供元**: 気象庁MSM（メソスケールモデル）の数値予報出力を、
  Open-Meteo（https://open-meteo.com/ ）という第三者サービスが再配信。
  気象庁が自ら提供する開発者向け公式APIではないが、元データは気象庁の
  数値予報モデルそのもの。
- **エンドポイント**: `https://api.open-meteo.com/v1/jma`
- **時間解像度**: 1時間（前1時間の合計値）
- **予測期間**: 最大4日間（96時間）、3時間ごとに更新
- **空間解像度**: 約0.05度（約5km格子）。地点(緯度経度)を指定すると最寄りの
  格子点の値が返るとみられ、**河川流域平均ではない**（点予報）。
- **APIキー**: 非商用・研究用途では不要
- **利用規約**: CC BY 4.0（出典表記必須）。非商用は1日10,000リクエストまで
  無料。「public research at public institutions」が非商用利用の例として
  明記されている（大学の卒業研究に該当すると考えられる）。
- **実装**: `lib/rainfallForecastOpenMeteo.ts`。JSONレスポンスのため、
  ブラウザのCanvas API等に依存しない → **Firebase Functions(Node.js)からも
  そのまま呼び出し可能**（気象庁ナウキャストのPNGタイル解析と異なり、
  サーバー側の追加実装が不要）。
- **既存のナウキャスト予測(N2, lib/rainfallForecast.ts)との使い分け**:
  N2は5分刻み・60分先まで（短時間の急な変化向き）、Open-Meteo/JMA MSMは
  1時間刻み・96時間先まで（3〜24時間規模の積算向き）。どちらか一方で
  他方の代わりをしない（例：60分予測から24時間分を外挿しない）。

## forecast run再現性の監査結果（重要な訂正）

- **確認日**: 2026-09-08
- 前回のBacktest（`historical-forecast-api`使用）は、「forecast run間継続性」
  の検証に**不適切だった**ことを公式ドキュメントで確認した。公式には
  「各runの最初の数時間だけがつなぎ合わされた連続時系列」
  ("Each run's first few hours are stitched into a continuous hourly
  timeseries.")と明記されており、個々のrunの全forecast horizonを保持して
  いない。前回の「区域内2→1件、区域外6→0件」という結果は、**コードが
  動作することを確認した予備的な技術確認結果**であり、run間継続性を
  正しく再現した研究結果ではない（本実験データとしては使用しない）。
- 代わりに **Single Runs API**
  (`https://single-runs-api.open-meteo.com/v1/forecast`、`&run=`パラメータで
  run初期時刻を明示指定)を使うことで、個々のJMA MSM runを独立に取得できる
  ことを実際のAPI呼び出しで確認した。
  - 同一run再取得時の完全な再現性を確認
  - 3時間後の別run("...T03:00"等)が異なる予報値を返すことを確認
  - 1回のレスポンスで168時間(7日間)分のforecast horizonを保持することを確認
  - JMA MSM(`models=jma_msm`)で200 OKを確認
  - 利用可能期間: 大多数のモデルは2026年4月2日以降にアーカイブされたrunの
    み取得可能（公式記載）。本実験期間はこの制約を客観的な下限とする。
- **重要な追加発見**: run初期化時刻の直後（実際に35分後で検証）は、まだ
  Single Runs APIで取得できないことを実際に確認した
  （400エラー："The requested model run is not available"）。
  run初期化時刻と実際にAPI上で利用可能になる時刻には時間差があるとみられる
  （Open-MeteoのMetadata API概念にある`last_run_availability_time`に相当）。
  本番監視でこのAPIを使う場合、run初期化直後を即座に評価しようとせず、
  十分な安全マージンを設けるか、Metadata APIで実際の利用可能時刻を
  確認してから取得する設計が必要（Metadata APIの正確なエンドポイントURLは
  今回のセッションでは確認できておらず、実装前に別途確認が必要）。
- **もう1つの発見**: Single Runs APIのレスポンスは、run初期化時刻そのもの
  に対応する先頭の1件が常に`null`になる（直前1時間分のデータが存在しない
  ため）。「次の1〜6時間」を計算する際は、この先頭要素を除いた
  index 1〜6を使う必要がある（`scripts/research-data/
  notification-run-verification.mjs`で実装・確認済み）。
- `lib/notificationExperiment.ts`の`ForecastRunSnapshot`に
  `runInitialisationTime`を追加し、run間継続性の判定はこれを優先的な識別子
  として使うよう変更した（`contentHash`は「内容が変化したかの確認用」の
  補助情報として残すのみで、run IDの代替としては使わない）。
- Backtestを二層に分離する方針とした：
  - **Rain Event Dataset**（`historical-forecast-api`使用）：雨天日・降雨
    イベント・IETDによるイベント分離等、連続的な実況把握が目的
  - **Forecast Run Dataset**（`fetchSingleRun()`使用）：forecast run間継続性
    の検証が目的
  - `scripts/research-data/notification-backtest.mjs`（Rain Event Dataset
    用途に限定、既存のまま）と`scripts/research-data/
    notification-run-verification.mjs`（Forecast Run Dataset用途、新規）
    に分離した。

## 通知判定ロジックの位置づけ（重要・繰り返し明記）

`lib/notificationExperiment.ts`以下で実装している「案C」（staticFloodHazard
＋予測降雨＋状態変化＋継続性）は、**「ハザードマップ想定降雨と完全に連携した
最終方式」ではなく、複数の通知判定方式を比較するための実験基盤**である。

- 想定降雨量との直接比較（`lib/rainfallAssumption.ts`）は、河川ごとに
  異なる想定降雨条件をタイルから逆引きできないため未達成のまま。
  分母を推測したり、大阪市全体で1つの想定降雨量を仮定したりしていない。
- 今回の暫定方式は、(1)洪水浸水想定区域内か、(2)予測降雨の規模、
  (3)降雨予測が一時的か継続的か、(4)前回評価からの状態変化、のみを
  使って不要通知を抑制できるかを研究・検証するものであり、最終的な
  閾値・採用方式はまだ決定していない（`notificationDecisionConfig.enabled`
  は引き続き`false`）。

## Open-Meteo（JMA MSM）の出典表記について

CC BY 4.0ライセンスに基づき、以下の出典表記が必要（利用規約より）。

- **アプリのデータ出典画面**（未実装。将来追加する場合）：「降雨予測データ:
  Weather data by Open-Meteo.com (CC BY 4.0)」等、Open-Meteo公式が推奨する
  形式でのクレジット表記＋ライセンスへのリンクを掲載する。
- **README/卒論**：「本アプリの降雨予測にはOpen-Meteo
  (https://open-meteo.com/) を通じて気象庁MSM(メソスケールモデル)の
  数値予報データを利用した」旨を明記し、CC BY 4.0であることを付記する。
- 現時点ではUIにまだ降雨予測を表示していないため、実装時に上記を追加すること。

## Vercel Cron / Firebase Scheduled Functionsの実行頻度についての追加検討

JMA MSMは3時間おきに更新されるため、10分間隔での全量取得・全量評価は
「同じ予報を最大18回重複して評価する」ことになりうる。
`lib/notificationExperiment.ts`の`hasForecastChanged()`（contentHashによる
比較）を使えば、内容が変化していない場合は評価自体をskipできる設計にして
ある（Scheduled Functions自体は10分ごとに起動してよいが、中身の評価は
予報が更新された時だけ行う、という構成が可能）。

| 方式 | 通知遅延 | API負荷 | Firestore負荷 | 実装容易性 |
|---|---|---|---|---|
| A. 10分ごとに取得・同一ならskip | 低い(最大10分) | やや高い(取得自体は毎回発生) | 低い(skip時は書き込みなし) | 中(hash比較の実装が必要) |
| B. 30分ごと | 中 | 中 | 低い | 低 |
| C. 1時間ごと | 中〜高 | 低い | 低い | 低 |
| D. モデル更新周期(3時間)に合わせる | 高い(最大3時間) | 最も低い | 最も低い | 低いが、実際のMSM更新タイミングとのズレ調整が必要 |

Aが最も実装コストと通知遅延のバランスが良いと考えられるが、まだ確定していない。

## Firebase Scheduled Functionsの技術的制約（重要・未解決）

- `lib/tilePixel.ts`（ハザード・降雨タイルのピクセル読み取り）は、
  ブラウザの`Canvas`/`Image`/`URL.createObjectURL`に依存しており、
  Node.js環境（Firebase Cloud Functions）ではそのまま動作しない。
- 判定ロジック自体（`hazardPixelClassifier.ts`の`interpretTileSample`、
  `rainfallColorLegend.ts`の`matchRainfallColor`）は純粋な計算のため
  サーバー側でも再利用できるが、「タイル画像を取得してピクセル色を読む」
  というI/O部分だけは、Node.js対応の別実装（例: `pngjs`等によるPNG
  デコード）が必要。**この部分は試作3時点で未実装**であり、
  `functions/src/index.ts`の定期監視は現時点では実際の降雨予測・
  静的ハザード情報を取得せず、常に`insufficient_data`相当のダミー入力で
  評価関数を呼び出す配管確認にとどまっている。
