// 地域判定基盤（Phase 2: 大阪市専用構造の一般化）: 共通の型定義。
//
// 【重要】ここでの「対応地域」は近畿2府4県（滋賀・京都・大阪・兵庫・奈良・
// 和歌山）を指す。三重県は今回対象に含めないが、PrefectureCodeのunion型に
// 1行追加するだけで拡張できるようにしてある（追加すると、この型を使う
// Record型の網羅性チェックにより、対応漏れの箇所がコンパイルエラーとして
// 検出される）。
//
// 【重要】「地域として近畿2府4県のどこかに該当する」ことと、「その地域で
// 実際に各機能（避難所・内水氾濫等）が使えること」は別概念として扱う。
// 前者はRegion/RegionCheckResult、後者はcapability.tsのRegionCapabilityが
// 担当する（詳細はcapability.ts参照）。

/** JIS X 0401 都道府県コード（先頭ゼロを保持するため文字列）。今回対応する近畿2府4県のみ。 */
export type PrefectureCode = "25" | "26" | "27" | "28" | "29" | "30";

export const PREFECTURE_NAMES: Record<PrefectureCode, string> = {
  "25": "滋賀県",
  "26": "京都府",
  "27": "大阪府",
  "28": "兵庫県",
  "29": "奈良県",
  "30": "和歌山県",
};

/**
 * 都道府県コード→英字slug（ファイル名・URL等に使う）。
 * Phase 4: scripts/build-shelters.mjs（出力ファイル名の決定）と
 * lib/shelter/*Provider.ts（JSONのfetch先URL）の両方で、同じ対応表を
 * 二重管理しないよう、ここに一元化する。
 */
export const PREFECTURE_SLUGS: Record<PrefectureCode, string> = {
  "25": "shiga",
  "26": "kyoto",
  "27": "osaka",
  "28": "hyogo",
  "29": "nara",
  "30": "wakayama",
};

/**
 * JIS X 0402 全国地方公共団体コード（5桁、先頭ゼロを保持するため文字列）。
 * 例:"27100"（大阪市）。今回のPhaseでは境界データを保有する市区町村のみ
 * 解決できる（未保有の市区町村では省略され、都道府県までの判定にとどまる）。
 */
export type MunicipalityCode = string;

export type Region = {
  prefectureCode: PrefectureCode;
  prefectureName: string;
  /** 市区町村境界データを保有していない場合はundefined（都道府県までの判定）。 */
  municipalityCode?: MunicipalityCode;
  municipalityName?: string;
  /** Phase 6 PART B: 現在地からCROSS_PREFECTURE_SEARCH_DISTANCE_METERS以内
   *  にある、実際に隣接する都道府県のコード一覧（lib/region/
   *  prefectureAdjacency.ts参照）。空配列は「その距離内に隣接県が無い」
   *  ことを意味する（府県境から十分離れた地点等）。避難先候補検索
   *  （lib/shelter/crossPrefectureSearch.ts）が、隣接ProviderのJSONも
   *  取得すべきかどうかの判断に使う。 */
  nearbyPrefectureCodes: PrefectureCode[];
};

/**
 * checkRegion()の判定結果。
 * - "supported": 近畿2府4県のいずれかに該当する地点として判定できた（regionを伴う）
 * - "outside": 近畿2府4県のいずれにも該当しないと判定できた（＝「近畿外」。判定不能ではない）
 * - "unknown": 判定できなかった（府県境付近で確信が持てない場合や、境界データの
 *   該当なし等）。「近畿外」と混同してはならない。府県境バッファのあいまいさが
 *   原因の場合は、reason:"boundary_ambiguity"とcandidatePrefectureCodes
 *   （どの都道府県の可能性があるか）を伴う（Phase 6 PART B）。
 *   【重要】この情報は「unknownをsupportedへ格上げする」ためのものではない
 *   （どちらの府県か確定できないという判定そのものは変えない）。あくまで
 *   「候補となりうる複数府県のShelterデータを検索してよいか」の判断材料。
 * - "error": 判定処理自体が技術的に失敗した（データ読み込み失敗・例外等）。
 */
export type RegionCheckStatus = "supported" | "outside" | "unknown" | "error";

export type RegionCheckResult =
  | { status: "supported"; region: Region }
  | { status: "outside" }
  | { status: "unknown"; reason?: "boundary_ambiguity"; candidatePrefectureCodes?: PrefectureCode[] }
  | { status: "error"; message: string };
