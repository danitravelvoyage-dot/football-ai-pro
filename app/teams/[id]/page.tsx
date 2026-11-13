import { notFound } from "next/navigation";
import { GoalsTrendChart } from "@/components/charts";
import { MatchCard } from "@/components/MatchCard";
import { Crest, FormPills, Kpi, Panel, PageHeader, SourceBadge, UnavailableNote } from "@/components/ui";
import { addDaysYmd, ymdInTz } from "@/lib/dates";
import { getI18n } from "@/lib/i18n/server";
import { summariseTeam } from "@/services/analysis";
import { getMatchesBetween } from "@/services/matches";
import { getFixturesProvider } from "@/services/providers";
import { isUnavailable } from "@/types";

export const dynamic = "force-dynamic";
// allow waiting out a free-tier rate-limit window instead of failing (Vercel Hobby max is 60s)
export const maxDuration = 60;

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  if (!/^[A-Za-z0-9-]{1,40}$/.test(id)) notFound();
  const { t, fmt, tz } = await getI18n();
  const fx = getFixturesProvider();
  const [details, recent] = await Promise.all([fx.getTeam(id), fx.getTeamMatches(id, 20)]);
  if (isUnavailable(details) && details.reasonKey === "provider.notFound") notFound();
  const ms = isUnavailable(recent) ? [] : recent.data;
  const leagueCode = ms.find((m) => m.competition.type === "LEAGUE")?.competition.code;
  const standings = leagueCode ? await fx.getStandings(leagueCode) : null;
  const st = standings && !isUnavailable(standings) ? standings.data : null;
  const s = summariseTeam(id, ms, new Date(), st);
  const team = !isUnavailable(details) ? details.data.team : ms[0] ? (ms[0].homeTeam.id === id ? ms[0].homeTeam : ms[0].awayTeam) : null;
  if (!team) notFound();
  const today = ymdInTz(new Date(), tz);
  const feed = await getMatchesBetween(today, addDaysYmd(today, 10), tz);
  const upcoming = feed.matches.filter((m) => (m.homeTeam.id === id || m.awayTeam.id === id) && m.status !== "FINISHED");
  const trend = [...s.recent].reverse().map((m, i) => {
    const home = m.homeTeam.id === id;
    return { label: `${i + 1}`, for: (home ? m.score.fullTime.home : m.score.fullTime.away)!, against: (home ? m.score.fullTime.away : m.score.fullTime.home)!, xg: m.stats?.xg ? (home ? m.stats.xg.home : m.stats.xg.away) : null };
  });

  return (
    <>
      <PageHeader title={team.name} subtitle={st ? `${st.competition.name} · #${s.standing?.position ?? "—"}` : undefined}
        right={<div className="flex items-center gap-3"><Crest team={team} size={56} /></div>} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <Kpi label={t("stat.avgScored")} value={fmt.num(s.avgFor)} />
        <Kpi label={t("stat.avgConceded")} value={fmt.num(s.avgAgainst)} tone="azure" />
        <Kpi label={t("stat.cleanSheets")} value={`${s.cleanSheets}/${s.matches}`} tone="slate" />
        <Kpi label={t("stat.over25")} value={fmt.pct(s.over25Rate, 0)} tone="gold" />
        <Kpi label={t("stat.xg")} value={fmt.num(s.xgFor)} hint={s.xgFor === null ? t("common.notSupplied") : undefined} />
        <Kpi label={t("stat.xga")} value={fmt.num(s.xgAgainst)} tone="azure" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Panel title={t("teams.goalsTrend")} right={!isUnavailable(recent) ? <SourceBadge source={recent.source} /> : undefined}>
            {isUnavailable(recent) ? <UnavailableNote u={recent} /> : <GoalsTrendChart data={trend} />}
          </Panel>
          <Panel title={t("teams.recentMatches")}>
            {s.recent.length === 0 ? <p className="text-sm text-mute">{t("common.noData")}</p> : (
              <div className="grid gap-3 sm:grid-cols-2">{s.recent.map((m) => <MatchCard key={m.id} match={m} />)}</div>
            )}
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title={t("teams.overview")}>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-2"><dt className="text-mute">{t("stat.last5")}</dt><dd><FormPills form={s.last5} /></dd></div>
              <div className="flex justify-between gap-2"><dt className="text-mute">{t("stat.last10")}</dt><dd><FormPills form={s.last10} size="xs" /></dd></div>
              <div className="flex justify-between gap-2"><dt className="text-mute">{t("stat.homePerf")}</dt><dd className="num">{s.home.played} · {fmt.num(s.home.avgFor)}–{fmt.num(s.home.avgAgainst)} · {s.home.points} {t("common.points")}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-mute">{t("stat.awayPerf")}</dt><dd className="num">{s.away.played} · {fmt.num(s.away.avgFor)}–{fmt.num(s.away.avgAgainst)} · {s.away.points} {t("common.points")}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-mute">{t("stat.btts")}</dt><dd className="num">{fmt.pct(s.bttsRate, 0)}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-mute">{t("stat.failedToScore")}</dt><dd className="num">{s.failedToScore}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-mute">{t("stat.shots")}</dt><dd className="num">{fmt.num(s.shots, 1)}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-mute">{t("stat.possession")}</dt><dd className="num">{fmt.num(s.possession, 1)}</dd></div>
              {!isUnavailable(details) && (
                <>
                  {details.data.coach && <div className="flex justify-between gap-2"><dt className="text-mute">{t("teams.coach")}</dt><dd>{details.data.coach}</dd></div>}
                  {details.data.venue && <div className="flex justify-between gap-2"><dt className="text-mute">{t("teams.venue")}</dt><dd>{details.data.venue}</dd></div>}
                  {details.data.founded && <div className="flex justify-between gap-2"><dt className="text-mute">{t("teams.founded")}</dt><dd className="num">{details.data.founded}</dd></div>}
                  <div className="flex justify-between gap-2"><dt className="text-mute">{t("teams.competitions")}</dt><dd dir="ltr">{details.data.runningCompetitions.join(", ")}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-mute">{t("intel.squad")}</dt><dd>{details.data.squad.length ? t("intel.squadSize", { n: details.data.squad.length }) : t("common.notSupplied")}</dd></div>
                </>
              )}
            </dl>
          </Panel>
          <Panel title={t("teams.upcoming")}>
            {upcoming.length === 0 ? <p className="text-sm text-mute">{t("common.noData")}</p> : <div className="space-y-3">{upcoming.map((m) => <MatchCard key={m.id} match={m} />)}</div>}
          </Panel>
        </div>
      </div>
    </>
  );
}
