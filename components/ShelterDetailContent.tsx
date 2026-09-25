"use client";

// 避難所詳細情報の拡充: 避難先候補の詳細情報の中身。
//
// 【重要】これ自身はモーダルの外枠(ui/Modal)を持たない。EvacuationPanel側の
// 既存Modalを共有し、その1ビュー(view==="shelterDetail")として表示する
// ことで、詳細を開いたときにモーダルが二重に重なる(閉じるボタンや
// Escapeキー処理が競合する)ことを避けている。
//
// 表示するのは、既存データ(GSI＋大阪市オープンデータで補完できた場合のみの
// telephone/availableHours/ward)からそのまま得られる情報のみ。
// 開設状況(開設中/閉鎖/混雑等)・受入可能人数・避難所規模は取得できないため、
// ここでは一切表示・推測しない。

import type { FloodShelterCandidate } from "@/lib/floodShelterCandidates";
import { toHazardLabels } from "./hazardLayers";
import Button from "./ui/Button";
import Notice from "./ui/Notice";

const OFFICIAL_LINKS = [
  {
    label: "大阪市 災害時ホームページ（避難場所・避難所）",
    provider: "大阪市",
    url: "https://www.city.osaka.lg.jp/kikikanrishitsu/page/0000255675.html",
  },
  {
    label: "おおさか防災ネット 避難所検索",
    provider: "大阪府",
    url: "https://www.osaka-bousai.net/shelter/index.html",
  },
];

function formatMeters(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`;
}

// 【重要・データの扱い】大阪市オープンデータのTEL列は市内番号のみ
// (市外局番06を含まない)形式で提供されている(例:"6613-0160"。
// data/README.md参照)。表示は取得した値をそのまま使い、電話をかけるための
// tel:リンクのみ、大阪市の施設であることを前提に市外局番06を機械的に補う
// (新しい番号を作り出しているのではなく、元データの前提を補っているだけ)。
//
// 【重要・安全側の方針】「6931-0237～0238」のように、1つのセルへ複数の
// 番号(範囲・並記)が入っているレコードが実データで約5%(509件中27件)
// 確認できた。これをそのまま数字だけ抽出すると、2つの番号が連結された
// 存在しない番号になってしまう。そのため、単一の番号だと確実に判断できる
// 形式(市内番号-下4桁)の場合のみtel:リンクを作る。それ以外は誤発信を
// 避けるため、リンク化せずテキスト表示のみにする(架空の番号を生成しない)。
const SINGLE_PHONE_NUMBER_PATTERN = /^[0-9]{2,4}-[0-9]{4}$/;

function toTelHref(rawTelephone: string): string | null {
  const trimmed = rawTelephone.trim();
  if (!SINGLE_PHONE_NUMBER_PATTERN.test(trimmed)) return null;
  const digits = trimmed.replace(/[^0-9]/g, "");
  return digits.startsWith("0") ? `tel:${digits}` : `tel:06${digits}`;
}

export default function ShelterDetailContent({
  shelter,
  onViewRoute,
}: {
  shelter: FloodShelterCandidate;
  /** 「この避難先までの参考ルートを見る」を押した時。既存のルート取得フローへ処理を渡すだけで、ここでは新しいルートロジックを持たない。 */
  onViewRoute: () => void;
}) {
  const hazardLabels = toHazardLabels(shelter.hazards);
  const hasFacilityInfo = Boolean(shelter.telephone || shelter.availableHours);

  return (
    <div>
      <section>
        <p className="text-base font-bold leading-snug text-[var(--color-text-primary)]">{shelter.name}</p>
        <p className="mt-1 text-sm leading-relaxed text-[var(--color-text-secondary)]">{shelter.address}</p>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          {shelter.ward && <>{shelter.ward}・</>}
          現在地から直線距離で約{formatMeters(shelter.straightLineDistanceMeters)}
        </p>
      </section>

      <section className="mt-4">
        <h4 className="text-sm font-bold text-[var(--color-text-primary)]">災害対応</h4>
        {shelter.type === "shelter" ? (
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">指定避難所（災害種別による区分はありません）</p>
        ) : hazardLabels.length > 0 ? (
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {hazardLabels.map((label) => (
              <li
                key={label}
                className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2.5 py-1 text-xs font-bold text-[var(--color-text-primary)]"
              >
                {label}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">対応する災害種別の情報がありません</p>
        )}
      </section>

      {hasFacilityInfo && (
        <section className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3.5">
          <h4 className="text-sm font-bold text-[var(--color-text-primary)]">施設情報</h4>
          {shelter.telephone &&
            (() => {
              const telHref = toTelHref(shelter.telephone);
              return (
                <p className="mt-1.5 text-sm text-[var(--color-text-primary)]">
                  電話番号：
                  {telHref ? (
                    <a href={telHref} className="break-all font-bold text-[var(--color-primary)] underline underline-offset-2">
                      {shelter.telephone}
                    </a>
                  ) : (
                    <span className="break-all font-bold">{shelter.telephone}</span>
                  )}
                </p>
              );
            })()}
          {shelter.availableHours && (
            <p className="mt-1.5 text-sm text-[var(--color-text-primary)]">利用可能時間：{shelter.availableHours}</p>
          )}
          <p className="mt-2 text-xs leading-relaxed text-[var(--color-text-muted)]">
            ※「利用可能時間」は施設が本来利用できる時間帯の情報です。現在実際に開設しているかどうかを示すものではありません。
          </p>
        </section>
      )}

      <div className="mt-4">
        <Notice tone="info" title="開設状況は公式情報をご確認ください">
          この避難所が現在実際に開設されているかは、このアプリでは分かりません。大阪市・大阪府等の公式情報をご確認ください。
        </Notice>
      </div>

      <section className="mt-4">
        <h4 className="text-sm font-bold text-[var(--color-text-primary)]">公式情報</h4>
        <ul className="mt-1.5 space-y-2">
          {OFFICIAL_LINKS.map((link) => (
            <li key={link.url}>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm font-bold leading-snug text-[var(--color-primary)] underline underline-offset-2"
              >
                {link.label}（{link.provider}提供）
                <span aria-hidden>↗</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <Button onClick={onViewRoute} fullWidth size="lg" className="mt-5">
        この避難先までの参考ルートを見る
      </Button>

      <p className="mt-3 text-xs leading-relaxed text-[var(--color-text-muted)]">
        このアプリの表示は避難先を検討するための参考情報です。実際の開設状況や避難情報は、大阪市・大阪府等の公式情報をご確認ください。
      </p>
    </div>
  );
}
