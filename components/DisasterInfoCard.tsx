"use client";

// 「災害関連情報」カード（河川・道路・避難所の公式情報への入口）。
//
// 【重要・今回の目的】アプリ独自のリアルタイム情報を表示するのではなく、
// 「公式情報へ素早くアクセスできる入口をアプリ内に作る」こと。
// lib/river・lib/road・lib/shelter-statusの各Providerは、調査の結果
// 無料かつ権利関係が明確な自動取得手段が確認できなかったため、常に
// status="unknown"・fetchedAt=nullを返し、実際にアクセス確認済みの公式
// サイトへのリンクのみを提供する設計になっている（各Provider参照）。
// 将来、正式な許諾やAPIが得られた場合は、各Providerの中身を実データ取得に
// 差し替えるだけでよく、このUI（ExternalDisasterInfoCard）はstatusTone・
// statusLabel・fetchedAtを渡し替えるだけで、そのまま実データ表示に拡張できる。
//
// 【重要・混同防止】ここでの「避難所情報」は避難所の開設・混雑状況という
// 外部リンクへの入口であり、地図上に表示されている既存の避難所データ
// （ShelterLayer・floodShelterCandidates等）そのものではない。既存の
// 避難所表示・避難ルート評価には一切触れていない。
//
// 既存のRiskCardと同じ折りたたみパターン（要約行をbuttonにし、
// aria-expanded/aria-controlsで詳細を開閉）を踏襲している。

import { useEffect, useId, useState } from "react";
import { getRiverStatus } from "@/lib/river/provider";
import { getRoadRestriction } from "@/lib/road/provider";
import { getShelterStatus } from "@/lib/shelter-status/provider";
import ExternalDisasterInfoCard from "./ExternalDisasterInfoCard";
import { InfoIcon, ChevronDownIcon } from "./ui/icons";

export default function DisasterInfoCard() {
  const cardId = useId();
  const [expanded, setExpanded] = useState(false);
  const [river, setRiver] = useState<Awaited<ReturnType<typeof getRiverStatus>> | null>(null);
  const [road, setRoad] = useState<Awaited<ReturnType<typeof getRoadRestriction>> | null>(null);
  const [shelter, setShelter] = useState<Awaited<ReturnType<typeof getShelterStatus>> | null>(null);

  // 【重要】各Providerは常にstatus="unknown"を即座に返すだけで、実際の
  // ネットワーク通信は発生しない（外部サービスへの高頻度アクセスは行わない）。
  useEffect(() => {
    let cancelled = false;
    getRiverStatus().then((result) => {
      if (!cancelled) setRiver(result);
    });
    getRoadRestriction().then((result) => {
      if (!cancelled) setRoad(result);
    });
    getShelterStatus().then((result) => {
      if (!cancelled) setShelter(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const detailSectionId = `${cardId}-detail`;

  return (
    <div className="mt-2 rounded-[var(--radius-lg)] border-2 border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={detailSectionId}
        className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors active:opacity-90"
      >
        <InfoIcon className="mt-0.5 h-6 w-6 shrink-0 text-[var(--color-text-secondary)]" />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-[var(--color-text-secondary)]">災害関連情報</span>
          <span className="mt-0.5 block text-sm leading-snug text-[var(--color-text-primary)]">
            河川・道路・避難所の公式情報へのリンク
          </span>
        </span>
        <span className="mt-0.5 flex shrink-0 items-center gap-1 text-xs font-bold text-[var(--color-primary)]">
          {expanded ? "閉じる" : "詳細を見る"}
          <ChevronDownIcon
            className={`h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
          />
        </span>
      </button>

      {expanded && (
        <div id={detailSectionId} className="space-y-2.5 px-4 pb-3.5">
          <p className="text-xs leading-snug text-[var(--color-text-secondary)]">
            このアプリでは一部のリアルタイム情報を自動取得していません。災害時は自治体・気象庁・国土交通省等の公式情報を必ず確認してください。
          </p>

          {river && (
            <ExternalDisasterInfoCard
              title="河川情報"
              statusTone="unknown"
              statusLabel="リアルタイム情報は未連携"
              description="河川の水位やライブカメラ情報は公式情報をご確認ください。"
              sourceLinks={river.sources}
              fetchedAt={river.fetchedAt}
            />
          )}

          {road && (
            <ExternalDisasterInfoCard
              title="道路情報"
              statusTone="unknown"
              statusLabel="規制情報は未連携"
              description="通行止め・冠水等の道路規制情報は公式情報をご確認ください。"
              sourceLinks={road.sources}
              fetchedAt={road.fetchedAt}
            />
          )}

          {shelter && (
            <ExternalDisasterInfoCard
              title="避難所の開設状況"
              statusTone="unknown"
              statusLabel="リアルタイム情報は未連携"
              description="避難所の開設状況は、自治体の公式情報をご確認ください。"
              sourceLinks={shelter.sources}
              fetchedAt={shelter.fetchedAt}
            />
          )}
        </div>
      )}
    </div>
  );
}
