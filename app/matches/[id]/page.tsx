import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarketTables } from "@/components/match/MarketTables";
import { MarketVsModel, RatingBars, ReportView, StatsSection, TeamIntel } from "@/components/match/Sections";
import { TrackForm } from "@/components/match/TrackForm";
import { Tabs } from "@/components/Tabs";
import { Crest, Notice, Panel, ProbBar, QualityBadge, SourceBadge, StatusPill } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { analyseMatch } from "@/services/analysis";
import { getFixturesProvider } from "@/services/providers";
import { generateReport } from "@/services/report";
import type { MarketKey } from "@/types";

export const dynamic = "force-dynamic";
// allow waiting out a free-tier rate-limit window instead of failing (Vercel Hobby max is 60s)
export const maxDuration = 60;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Match ${id.slice(0, 40)}` };
}

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) notFound();
  const { t, fmt } = await getI18n();
  const a = await analyseMatch(id).catch(() => null);
  if (!a) notFound();
  const m = a.match.data;
  const p = a.prediction;
  const fx = getFixturesProvider();
  const squads = await Promise.all([fx.getTeam(m.homeTeam.id), fx.getTeam(m.awayTeam.id)]);
  const report = generateReport(a, t, fmt);
  const upcoming = ["SCHEDULED", "TIMED"].includes(m.status) && Date.now() < new Date(m.utcDate).getTime();
  const best = (["HOME", "DRAW", "AWAY"] as const).reduce((x, k) => (p.oneXTwo[k.toLowerCase() as "home"] > p.oneXTwo[x.toLowerCase() as "home"] ? k : x), "HOME" as "HOME" | "DRAW" | "AWAY");
  const defaultMarket = `1X2_${best}` as MarketKey;
  const ft = m.score.fullTime;

  const overview = (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-6">
        <Panel title={t("match.outcome")} right={<QualityBadge q={p.dataQuality} />}>
          <ProbBar {...p.oneXTwo} />
          <p className="mt-3 text-[11px] text-mute">{t("match.outcomeNote")}</p>
          <div className="mt-4 grid grid-cols-2 gap-3 text-center">
            <div className="rounded-lg bg-ink-800 p-3"><div className="eyebrow">{t("match.xgModel")} · {m.homeTeam.tla}</div><div className="num mt-1 text-2xl font-semibold text-emerald-400">{fmt.num(p.lambdaHome)}</div></div>
            <div className="rounded-lg bg-ink-800 p-3"><div className="eyebrow">{t("match.xgModel")} · {m.awayTeam.tla}</div><div className="num mt-1 text-2xl font-semibold text-azure-400">{fmt.num(p.lambdaAway)}</div></div>
          </div>
          {p.dataQuality.notes.length > 0 && (
            <ul className="mt-4 space-y-1 text-[11px] text-mute">{p.dataQuality.notes.map((n) => <li key={n}>• {t(n)}</li>)}</ul>
          )}
        </Panel>
        <MarketVsModel rows={a.market} margin={a.bookmakerMargin} odds={a.odds} uncertainty={a.prediction.probUncertainty} />
      </div>
      <div className="space-y-6">
        <Panel title={t("match.ratings")}><RatingBars p={p} homeTeam={m.homeTeam} awayTeam={m.awayTeam} /></Panel>
        <Panel title={t("track.title")}><TrackForm matchId={m.id} open={upcoming} defaultMarket={defaultMarket} /></Panel>
        <Panel title={t("match.modelVersion")}>
          <dl className="space-y-1.5 text-xs">
            <div className="flex justify-between gap-2"><dt className="text-mute">{t("match.modelVersion")}</dt><dd className="num" dir="ltr">{p.modelVersion}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-mute">{t("match.asOf")}</dt><dd className="num">{fmt.dateTime(a.asOf)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-mute">{t("match.homeAdv")}</dt><dd className="num">×{fmt.num(p.ratings.homeAdvantage)}</dd></div>
          </dl>
          <Link className="link mt-3 inline-block text-xs" href="/methodology">{t("nav.methodology")} →</Link>
        </Panel>
      </div>
    </div>
  );

  return (
    <>
      <Link href="/matches" className="mb-4 inline-flex items-center gap-1 text-xs text-mute hover:text-slate-200">
        <ArrowLeft className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />{t("common.back")}
      </Link>
      <header className="panel mb-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5 text-xs text-mute">
          <span><span dir="ltr">{m.competition.name}</span>{m.matchday ? ` · ${t("common.matchday")} ${m.matchday}` : ""}</span>
          <span className="flex items-center gap-2"><StatusPill status={m.status} /><span className="num">{fmt.dateLong(m.utcDate)} · {m.status === "SCHEDULED" ? t("common.timeTbc") : fmt.time(m.utcDate)}</span></span>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-6 md:px-8">
          <Link href={`/teams/${encodeURIComponent(m.homeTeam.id)}`} className="flex flex-col items-center gap-2 text-center sm:flex-row sm:text-start">
            <Crest team={m.homeTeam} size={56} />
            <div><div className="text-lg font-bold text-white md:text-2xl">{m.homeTeam.name}</div><div className="text-xs text-mute">{t("common.home")}</div></div>
          </Link>
          <div className="text-center">
            {ft.home !== null && ft.away !== null ? (
              <div className="num text-3xl font-bold text-white md:text-4xl" dir="ltr">{ft.home} – {ft.away}</div>
            ) : (
              m.status === "SCHEDULED" ? (
                <div className="text-lg font-semibold text-gold-300" title={t("common.timeTbcHint")}>{t("common.timeTbc")}</div>
              ) : (
                <div className="num text-2xl font-semibold text-slate-300" dir="ltr">{fmt.time(m.utcDate)}</div>
              )
            )}
            {m.score.halfTime.home !== null && <div className="num mt-1 text-[11px] text-mute" dir="ltr">HT {m.score.halfTime.home}-{m.score.halfTime.away}</div>}
          </div>
          <Link href={`/teams/${encodeURIComponent(m.awayTeam.id)}`} className="flex flex-col-reverse items-center gap-2 text-center sm:flex-row sm:justify-end sm:text-end">
            <div><div className="text-lg font-bold text-white md:text-2xl">{m.awayTeam.name}</div><div className="text-xs text-mute">{t("common.away")}</div></div>
            <Crest team={m.awayTeam} size={56} />
          </Link>
        </div>
        <div className="border-t border-line px-4 py-2"><SourceBadge source={a.match.source} /></div>
      </header>
      {!upcoming && <div className="mb-4"><Notice tone="azure">{t("match.preMatchNote")}</Notice></div>}
      <Tabs
        tabs={[
          { id: "overview", label: t("match.tabs.overview"), content: overview },
          { id: "markets", label: t("match.tabs.markets"), content: <MarketTables p={p} /> },
          {
            id: "stats", label: t("match.tabs.stats"),
            content: <StatsSection home={a.stats.home} away={a.stats.away} homeTeam={m.homeTeam} awayTeam={m.awayTeam} prediction={p} h2h={a.h2hFinished} h2hMaybe={a.h2h} />,
          },
          {
            id: "team", label: t("match.tabs.team"),
            content: <TeamIntel homeTeam={m.homeTeam} awayTeam={m.awayTeam} availability={a.availability} lineups={a.lineups} news={a.news} context={a.context} squads={squads} stats={a.stats} />,
          },
          { id: "report", label: t("match.tabs.report"), content: <ReportView sections={report} demo={a.match.source.demo} /> },
        ]}
      />
      <p className="mt-6 text-[11px] text-mute">{t("disclaimer.short")}</p>
    </>
  );
}
