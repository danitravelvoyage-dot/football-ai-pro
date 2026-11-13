import clsx from "clsx";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalibrationChart, CompareBarChart, DistributionChart } from "@/components/charts";
import { StandingsTable } from "@/components/StandingsTable";
import { Kpi, Panel, PageHeader, SourceBadge, UnavailableNote } from "@/components/ui";
import { getCompetition } from "@/lib/competitions";
import { getI18n } from "@/lib/i18n/server";
import { runBacktest } from "@/services/backtest";
import { getLeague } from "@/services/leagues";
import { isUnavailable } from "@/types";

export const dynamic = "force-dynamic";
// allow waiting out a free-tier rate-limit window instead of failing (Vercel Hobby max is 60s)
export const maxDuration = 60;

export default async function LeaguePage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ view?: string }> }) {
  const { code: raw } = await params;
  const { view } = await searchParams;
  const meta = getCompetition(raw);
  if (!meta) notFound();
  const { t, fmt } = await getI18n();
  const [{ standings, matches, summary }, bt] = await Promise.all([getLeague(meta.code), runBacktest(meta.code).catch(() => null)]);
  const v = view === "home" || view === "away" ? view : "total";
  const rows = !isUnavailable(standings) ? (v === "home" ? standings.data.home : v === "away" ? standings.data.away : standings.data.total) ?? standings.data.total : [];

  return (
    <>
      <PageHeader title={meta.name} subtitle={`${meta.country} · ${t("leagues.subtitle")}`}
        right={!isUnavailable(matches) ? <SourceBadge source={matches.source} /> : undefined} />
      {summary ? (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
          <Kpi label={t("leagues.gpg")} value={fmt.num(summary.goalsPerGame)} />
          <Kpi label={t("leagues.homeWin")} value={fmt.pct(summary.homeWinRate, 0)} tone="azure" />
          <Kpi label={t("leagues.drawRate")} value={fmt.pct(summary.drawRate, 0)} tone="slate" />
          <Kpi label={t("leagues.awayWin")} value={fmt.pct(summary.awayWinRate, 0)} tone="azure" />
          <Kpi label={t("leagues.over25")} value={fmt.pct(summary.over25Rate, 0)} tone="gold" />
          <Kpi label={t("leagues.btts")} value={fmt.pct(summary.bttsRate, 0)} tone="gold" />
          <Kpi label={t("leagues.cleanSheets")} value={fmt.pct(summary.cleanSheetRate, 0)} tone="slate" />
        </div>
      ) : isUnavailable(matches) ? <div className="mb-6"><UnavailableNote u={matches} /></div> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel title={t("leagues.standings")} right={
          <div className="flex gap-1" role="group" aria-label={t("leagues.tableSplit")}>
            {(["total", "home", "away"] as const).map((k) => (
              <Link key={k} href={`/leagues/${meta.code}${k === "total" ? "" : `?view=${k}`}`} aria-pressed={v === k} className={clsx("btn px-2 py-1 text-xs", v === k && "btn-primary")}>
                {k === "total" ? t("common.total") : k === "home" ? t("common.home") : t("common.away")}
              </Link>
            ))}
          </div>
        }>
          {isUnavailable(standings) ? <><UnavailableNote u={standings} />{meta.type !== "LEAGUE" && <p className="mt-2 text-xs text-mute">{t("leagues.cupNote")}</p>}</> : <StandingsTable rows={rows} />}
        </Panel>
        <div className="space-y-6">
          {summary && (
            <>
              <Panel title={t("leagues.goalDist")}><DistributionChart label={t("common.matches")} data={summary.goalDistribution.map((d) => ({ name: d.goals, value: d.count }))} /></Panel>
              <Panel title={t("leagues.homeAway")}>
                <CompareBarChart homeLabel={t("common.home")} awayLabel={t("common.away")}
                  data={[{ metric: t("common.goals"), home: +summary.homeGoalsAvg.toFixed(2), away: +summary.awayGoalsAvg.toFixed(2) }, { metric: t("leagues.outcomes"), home: +(summary.homeWinRate * 100).toFixed(1), away: +(summary.awayWinRate * 100).toFixed(1) }]} />
              </Panel>
            </>
          )}
        </div>
      </div>

      <Panel className="mt-6" title={t("leagues.backtest")} right={bt ? <span className="text-[11px] text-mute" dir="ltr">{bt.modelVersion} · {bt.provider}</span> : undefined}>
        {!bt ? <p className="text-sm text-mute">{t("common.noData")}</p> : (
          <>
            <p className="mb-4 text-xs text-mute">{t("leagues.backtestSub", { b: fmt.num(bt.baselineBrier, 3) })}</p>
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
              <Kpi label={t("leagues.n")} value={fmt.int(bt.n)} tone="slate" />
              <Kpi label={t("leagues.accuracy")} value={fmt.pct(bt.accuracy)} />
              <Kpi label={t("leagues.brier")} value={fmt.num(bt.brier, 3)} hint={t("history.lowerBetter")} tone={bt.brier < bt.baselineBrier ? "emerald" : "gold"} />
              <Kpi label={t("leagues.logLoss")} value={fmt.num(bt.logLoss, 3)} hint={t("history.lowerBetter")} tone="azure" />
              <Kpi label={t("leagues.ouAcc")} value={fmt.pct(bt.over25.accuracy)} tone="gold" />
            </div>
            <h3 className="eyebrow mb-2">{t("leagues.calibration")}</h3>
            <CalibrationChart data={bt.calibration} />
          </>
        )}
      </Panel>
    </>
  );
}
