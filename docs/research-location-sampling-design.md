# 要件定義書3
# Notification Backtest 本実験地点選定設計
# 承認前ドラフト

**ステータス: Draft / Not Yet Approved**

このドキュメントは設計のみを目的としており、本実験地点は生成していません。
`notificationDecisionConfig.enabled = false` は本ドキュメント作成時点で維持されています
（本番Push通知は無効のままです）。

関連コミット（技術確認完了時点）:
`5bcb1c64c7dc85847ab728d37ed2e9bda4c17115`
(`feat: add static flood hazard backtest pipeline`)

---

## 1. 研究目的

本実験地点選定は、以下4方式を同一地点集合・同一条件で比較するためのものである。

- **Method1: Rain Only** — 降雨条件のみ（比較対照）
- **Method2: Hazard + Rain** — staticFloodHazard区域内 かつ 降雨条件成立
- **Method3: Hazard + Rain + State Change** — Method2 + 状態変化（新規上昇時のみ候補）
- **Method4: Hazard + Rain + State Change + Persistence** — Method3 + forecast内/run間継続性

評価したいことは、

> staticFloodHazard・状態変化・継続性を条件へ追加していくことで、単純な降雨通知（Method1）と比べ、不要な通知候補をどの程度抑制できるか

である。

**最重要原則**: 地点選定自体で結果を作らない。地点は「Backtestの結果を見る前」に、機械的・再現可能な手続きのみで固定する。地点選定の結果を見てから地点を差し替える、閾値を調整する等は一切行わない。

---

## 2. 技術確認地点との分離

現時点で存在する地点 P001〜P004 は、すべて

```
technicalVerificationOnly: true
```

であり、**本実験には使用しない**。

- P001〜P003: `scripts/route-sampling-experiment.mjs` の既存確認済み座標（大阪市内であることを事前確認済み）を流用した、パイプライン動作確認用の地点。
- P004: staticFloodHazard方式Bのパイプラインを `floodStatus = hazard` の実例でも通すことを目的として、大阪市内の低地・河川沿い5候補（大正区・此花区・西淀川区・東淀川区・住之江区）を技術確認し、hazardと判定された3候補のうち西淀川区の地点を採用したもの（`data/README.md`「P004 technical verification selection」参照）。**hazardになる地点を探して選ぶ**という、本実験では禁止される手続きで選ばれているため、本実験地点へ昇格させることは禁止する。

本実験地点は、必ず

```
technicalVerificationOnly: false
```

を明示的に設定する（既存スキーマ上、このフィールドは必須・暗黙のfalseなし）。

---

## 3. Plan A〜C の比較

| 観点 | Plan A: 行政区域+グリッド+層化 | Plan B: 既存避難場所データ+層化無作為抽出 | Plan C: 人口分布考慮の層化抽出 |
|---|---|---|---|
| 概要 | 大阪市の行政区域ポリゴンを取得し、域内に等間隔グリッドを設定して候補母集団を生成。既存分類ロジックで全候補をhazard/outside/unknownへ機械分類し、層化・seed固定で無作為抽出する | 大阪市の指定緊急避難場所データ（既存・整備済み、3,211件）を候補母集団とし、既存分類ロジックで機械分類後、層化・seed固定で無作為抽出する | Plan Aの層化に、国勢調査の人口集中地区(DID)や人口メッシュ等を追加の層として組み込む |
| 再現性 | 高い（境界ポリゴン・グリッド式・seedを記録すれば再生成可能） | 高い（既存データセット・seedを記録すれば再生成可能） | 高いが、人口データのバージョン管理が別途必要 |
| 恣意性 | 低い（機械的グリッド + seed） | 低い（既存の公的データからseed抽出。目視選定なし） | 低いが、DID等の閾値設定に裁量が入りうる |
| 空間分散 | 高い（グリッドで機械的に全域を網羅） | 高い（避難場所は大阪市24区全域に分布） | 最も高い（人が実際にいる場所を反映） |
| hazard/outside比較 | 層化で確実に確保可能 | 層化で確実に確保可能（区ごとの偏りは要検討、§12参照） | 確保可能だが軸が増え設計が複雑化 |
| 実装負荷 | **高い**（大阪市行政区域ポリゴンの取得・パース・point-in-polygon判定が新規に必要） | **低い**（新規GISデータ依存なし。既存の`public/data/osaka-shelters.json`をそのまま候補母集団にできる） | **最も高い**（人口メッシュ/DIDデータの新規取得・実装が必要） |
| 追加データ | 行政区域ポリゴン（国土数値情報N03等、未取得） | 不要（既存データを流用） | 人口メッシュ/DID（未取得） |
| 卒論での説明可能性 | 標準的な空間統計手法として説明しやすいが、実装過程の説明も増える | 「既存の公的避難場所データを母集団に、層化無作為抽出した」という一文で説明可能 | 説明が最も長くなる |
| 一般ユーザー地点への代表性 | ある程度の代表性（空間的には市内全域を機械的にカバー） | **代表性は限定的（§4参照）**。避難場所は「一般ユーザーの居住地・現在地」の標本ではない | 最も代表性が高い設計だが未実装 |

---

## 4. Plan B の重要な Limitation

Plan Bでは、大阪市の既存避難場所データ（指定緊急避難場所等）を candidate population として利用する。

**この選択の理由は、あくまで研究実装上の利点である**:

- 公的データである
- 座標が整備済みである
- 実在する地点である（河川上・建物内部等の非現実的な座標を避けられる）
- 大阪市内の地点として扱いやすい（市域判定を別途実装しなくてよい）
- 現在のプロジェクトに既に整備済みで、新規データ依存が発生しない
- 再現可能な sampling frame を構成しやすい（データセットが固定・バージョン管理可能）

**しかし、避難場所地点は「一般ユーザーの居住地点・現在地点」を代表する標本ではない。**

- 避難場所は防災インフラとして選定された特定の施設（学校・公園・公共施設等）の座標であり、人がふだん生活・移動している任意の地点の無作為標本ではない。
- したがって、Plan Bの結果から
  - 「大阪市民全体ならこの通知数になる」
  - 「一般ユーザー全体の通知疲れを代表している」
  等の一般化は**行わない**。
- 今回のNotification Backtestで評価するのは、あくまで
  > **同一地点集合（Plan Bで固定した地点群）に対する、Method1〜4の相対比較**
  である。「Method2〜4はMethod1と比べてどの程度候補を絞り込むか」という**方式間の相対的な差**を見るための実験であり、絶対的な通知数や母集団全体への外挿を目的としない。
- この限界は卒論の考察・限界（limitations）セクションに明記する。

---

## 5. Plan B の地点数案の整理

これまでの議論で「標準24地点」という表現が、複数の異なる抽出方式を指して曖昧に使われていた。以下の3案として明確に分離する。

### Plan B-24A

candidate population 全体を既存staticFloodHazard classifierで機械分類し、
`hazard` / `outside` / `unknown` に分ける。

- `unknown` は Data Quality Dataset へ分離（§7参照）。
- `hazard` population と `outside` population それぞれから、固定seedによる決定論的無作為抽出で、

```
hazard   12地点
outside  12地点
──────────────
合計     24地点
```

を抽出する案。

空間的な偏り（特定区への集中）を抑えるため、「1区あたり最大N地点まで」等の制約を抽出アルゴリズムに組み込む方法を検討する（§12参照）。上限値Nの具体的な数字は今回まだ決定しない。

### Plan B-24B

大阪市24区のそれぞれから1地点ずつ選ぶ案（区単位の層化のみ、hazard/outsideは事後分類）。

```
24区 × 1地点 = 24地点
```

**長所**:
- 24区すべてを地点集合に含められる
- 空間分散が非常に説明しやすい（「各区から1地点」という単純な規則）

**短所**:
- hazard/outsideの比率が同数になる保証がない（区の地形によっては大半がoutside、あるいは大半がhazardになりうる）
- Method比較という主目的に対して、層のバランスが崩れる可能性がある（少数派の層で統計的な比較力が不足しうる）

### Plan B-48

大阪市24区それぞれについて、`hazard` 1地点・`outside` 1地点を取得する案。

```
24区 × (hazard 1 + outside 1) = 最大48地点
```

**長所**:
- 区内でhazard/outsideの比較が可能（区ごとの対比という新しい分析軸が持てる）
- 空間分布が非常に明確
- 24区を完全に網羅

**短所**:
- 各区に両方のstratum（hazard候補・outside候補）が存在する保証がない（地形によっては区内が完全にhazard、または完全にoutsideの場合がありうる）
- 地点数が最大48と多く、Single Runs APIの取得量・Backtest計算量・データ管理負荷が増える

各区に対象stratumの候補が存在しない場合、**人間が代替地点を手選定することは禁止**する。該当区・該当stratumは

```
stratum_not_available
```

として記録し、地点数はその分だけ少なくなることを許容する（無理に他区から補填したり、人間が目視で代替候補を探したりしない）。

---

## 6. 現時点の第一候補

**Recommended Candidate — Not Yet Approved**

```
Plan B-24A
hazard 12 + outside 12 = 24地点
```

**理由**: 今回の主目的は「hazard/outsideでMethod1〜4の通知数（候補発生数）がどう変わるか」の比較である。Plan B-24Aはhazard/outsideを明示的に同数確保する設計であるため、両群間の比較力を最大化しやすく、Plan B-24B（区単位のみで層バランス保証なし）より研究目的に直結する。Plan B-48はより豊かな分析軸（区内比較）を提供できる一方、地点数増加によるデータ管理・API取得負荷の増加に見合うだけの必要性が、現段階の研究目的（方式間相対比較）では明確でない。

この推奨はあくまで第一候補であり、正式採用には人間側の承認が必要（§16 Decision Required参照）。

---

## 7. unknown の扱い

`unknown` は主解析24地点へ**混ぜない**方向を第一候補とする。

**理由**: `unknown` は「hazardでもoutsideでもない」のではなく、そもそも**タイル・データが取得できなかった／判定できなかった**という、洪水リスクの状態とは別次元の「データ品質」の問題である。Method2〜4は既にunknownを一律「候補にしない」設計になっており（実装済み・実データ確認済み）、主解析へ混ぜても新しい比較情報が増えず、hazard/outside比較の検出力を薄めるだけになる。

- **主解析**: `hazard` / `outside`（Plan B-24A: 12 + 12）
- **Data Quality Dataset**: `unknown`（別集計。大阪市内でも実際に洪水タイルが提供されていない・判定できない地点が一定割合存在するという、卒論の限界・データ品質に関する正直な知見として報告する）

candidate populationを機械分類した際に生じたunknownについて、少なくとも以下を保存・集計できる設計とする。

- unknown総数
- unknown割合（candidate population全体に対する比率）
- reason内訳
  - `no_tile`（404）
  - `fetch_error`
  - `color_unknown`
  - `other`

必要であれば、Data Quality Dataset側で数地点を詳細確認することはあり得るが、**現時点では「unknown 4〜6地点を主解析へ追加する」等の決定はしない**（§16 Decision Requiredで人間が判断する）。

---

## 8. Candidate Population の固定

Plan Bでは、どの避難場所データを母集団として使うかを曖昧にせず、以下を記録する設計とする。

- `sourceDataset`（データセット名。例: 「大阪市 指定緊急避難場所」）
- `originalFilename`（元ファイル名）
- `sourceUrl`（取得元URL）
- `sourcePublicationDate` / `sourceUpdateDate`（判明する場合。判明しない場合はその旨を明記し、推測しない）
- `numberOfCandidatePoints`（候補点数。既存データでは「指定緊急避難場所：3,211件」「洪水対応指定緊急避難場所：1,734件」等が確認済み）
- `gitCommit`（このデータセットを固定した時点のリポジトリのcommit hash）
- `fileHash`（SHA-256等によるファイルハッシュ）
- `candidatePopulationVersion`（下記§9参照）

**単に `"latest"` 等の非固定な参照にはしない。** 避難場所データが将来更新されても、実験に使った時点のスナップショットを一意に再現できることを必須とする。

---

## 9. candidatePopulationVersion

candidate populationの再現性を確保するため、`candidatePopulationVersion` を、少なくとも以下の要素から一意に定義できる設計とする。

```
candidatePopulationVersion = f(sourceDataset, sourcePublicationDate or sourceUpdateDate, fileHash)
```

例えば `"osaka-shelters-2026-09-06-sha256:xxxxxxx"` のような、人間が読める形かつ一意な文字列を想定する。

具体的な値は、実際に地点生成Stepへ進む段階で確定する（今回は確定しない）。

---

## 10. Sampling Seed

sampling seedは、**地点抽出前・Backtest前**に固定する。

- **結果を見てseedを変更することは禁止する。**
- seedは `research-monitoring-points.json` の `metadata.samplingSeed` に保存するとともに、本設計文書（承認後の版）または関連するGit commitメッセージにも記録する。
- 具体的なseed値は、今回はまだ決定しない（§16 Decision Required）。

---

## 11. Sampling Algorithm（第一候補・未実装）

以下の流れを第一候補として整理する。**このアルゴリズムは今回まだ実装しない。**

```
candidate population（既存避難場所データ）
        ↓
既存staticFloodHazard classifier(lib/hazardPixelClassifier.ts)で
全候補を機械分類（結果を見た選定ではない、網羅的処理）
        ↓
hazard / outside / unknown
        ↓
unknownをData Quality Datasetへ分離
        ↓
hazard population        outside population
        ↓                        ↓
固定seedによる決定論的無作為抽出（各12地点、§12の空間偏り抑制策を適用）
        ↓
hazard 12地点 + outside 12地点 = 本実験24地点（Plan B-24A採用の場合）
```

---

## 12. 空間偏り対策の比較

市全体からhazard/outside各12を単純に無作為抽出すると、特定区（例えば避難場所が密集する区）へ地点が偏る可能性がある。以下の方式を比較する。

| 方式 | 概要 | 特徴 |
|---|---|---|
| A. 完全な層別random sampling | hazard/outsideのみを層とし、区は考慮しない単純無作為抽出 | 最も単純・実装が容易。ただし特定区への偏りを許容してしまう |
| B. 1区あたり最大地点数の事前設定 | hazard/outsideの層内で、同一区からの抽出数に上限（例: 1区あたり最大2地点等）を設ける | 単純な追加ルールで偏りを抑制できる。上限値の妥当性の説明が必要 |
| C. 区をsecondary stratumとして利用 | hazard×区、outside×区の二軸層化を行い、各セルから抽出 | 最も理論的に厳密だが、24区×2層=48セルのうち候補が存在しないセルが生じうる（Plan B-48と類似の問題） |
| D. Plan B-48採用 | 地点数そのものを増やし、24区×hazard/outside各1を目指す | §5参照。地点数が増加する |

今回の24地点規模では、**方式B（1区あたり最大地点数の事前設定）が、単純さと再現可能性のバランスにおいて最も扱いやすい**と考えられる。ただし、上限値の具体的な数字（例: 1・2・3のいずれか）は今回まだ最終決定しない。

---

## 13. 除外ルール

**Backtest結果を見た後の除外は禁止する。** 以下は事前に定義する除外ルール候補である。

- 座標不正（NaN・緯度経度が大阪市周辺の妥当範囲外・重複座標）
- 大阪市外であることが公式情報（避難場所データの管理主体情報等）から確認された地点
- Single Runs APIから、計画したrun全てで予報取得が技術的に不能な地点
- 入力データ（候補母集団データ）自体の破損・欠損

`staticFloodHazard = unknown` の地点は、candidate populationから黙って削除するのではなく、**Data Quality Dataset（§7）へ移す**扱いとする（除外ではなく再分類）。

除外された地点は、主要地点リストから消すのではなく、すべて `excludedPoints` のようなログへ以下を記録する。

- pointId
- 座標
- 除外理由
- 記録日時

---

## 14. 選定・固定手順（時系列）

本実験開始までの手順を、以下のように時系列で固定する。

1. Plan承認（本ドキュメントのDecision Required、§16）
2. candidate population version固定（§8・9）
3. sampling algorithm固定（§11）
4. sampling seed固定（§10）
5. **Git commit**（Plan・population version・algorithm・seedを含む設計の確定を記録）
6. candidate populationをstaticFloodHazardで機械分類（§11）
7. hazard / outside / unknown population生成
8. seed固定抽出（hazard 12 + outside 12、空間偏り対策を適用）
9. `research-monitoring-points.json` 生成
10. `technicalVerificationOnly: false` であることを確認
11. **Git commit**（地点ファイルを固定。Backtest実行前の地点確定を証明する、最も重要なコミット）
12. staticFloodHazard fixed JSON生成（既存の方式Bパイプラインを再利用）
13. **Git commit**（hazard入力を固定）
14. 本実験期間固定（別途決定）
15. 雨量閾値候補固定（別途決定）
16. IETD候補固定（別途決定）
17. persistence候補固定（別途決定）
18. Backtest開始

**Backtest結果を見て、地点・seed・candidate population・除外ルールを変更しないことを、研究手順として固定する。** 変更が必要になった場合は、新しいバージョンとして別途Plan・commitをやり直し、変更履歴を残す（黙って上書きしない）。

---

## 15. 地点ID

本実験地点のIDは、中立的な識別子を使用する。

```
E001, E002, E003, ...
```

技術確認地点（P001〜P004）と接頭辞を分け、混同を防ぐ。

`HAZARD01` / `SAFE01` のような、判定結果を示唆する命名は禁止する。

---

## 16. Decision Required（次Stepで人間が決定する内容）

- [ ] Plan Bを正式採用するか（Plan A・Plan Cではなく）
- [ ] Plan B-24A / Plan B-24B / Plan B-48 のどれを採用するか（本文書の第一候補はPlan B-24A、hazard 12 + outside 12）
- [ ] 空間偏り制約をどうするか（§12。方式A〜Dのいずれか、および上限値等の具体的パラメータ）
- [ ] candidate populationとして、どの避難場所データセット・どの時点のスナップショットを使用するか（§8・9）
- [ ] sampling seedの具体値（§10）
- [ ] 本実験地点数の最終確定（Plan B-24A採用の場合は24が既定だが、正式な承認が必要）

---

## 17. 今回の作業範囲

このドキュメントは設計のみを目的とし、以下は**実行していない**。

- 本実験地点の生成
- candidate populationの全候補classification
- random samplingの実行
- staticFloodHazardの本実験capture
- Single Runs APIの大量取得
- Notification Backtestの実行
- 雨量閾値・IETD・persistence条件の変更
- `notificationDecision` 関連コードの変更
- 本番Push通知の有効化
- 新規Gitタグの追加

`notificationDecisionConfig.enabled = false` は本ドキュメント作成時点で維持されている（Next.js側・Firebase Functions側とも変更なし）。
