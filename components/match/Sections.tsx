"use client";
import clsx from "clsx";
import Link from "next/link";
import type { MarketRow, TeamContext, TeamStatSummary } from "@/services/analysis";
import type { ReportSection } from "@/services/report";
import type { Lineup, Match, Maybe, NewsItem, PlayerAvailability, PredictionResult, TeamDetails, TeamRef } from "@/types";
import { isUnavailable } from "@/types";
import { CompareBarChart, GoalsTrendChart } from "../charts";
import { useI18n } from "../I18nProvider";
import { Crest, DemoBadge, FormPills, MiniBar, Panel, SourceBadge, UnavailableNote } from "../ui";

// ---------------- model vs market ----------------
export function MarketVsModel({ rows, margin, odds, uncertainty }: { rows: MarketRow[]; margin: number | null; odds: Maybe<unknown>; uncertainty?: number }) {
  const { t, fmt } = useI18n();
  return (
    <Panel title={t("match.marketVsModel")} right={!isUnavailable(odds) ? <SourceBadge source={odds.source} /> : undefined}>
      {isUnavailable(odds) ? (
        <UnavailableNote u={odds} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t("common.market")}</th><th>{t("common.model")}</th><th>{t("match.fairProb")}</th><th>{t("match.bestOdds")}</th>
                  <th>{t("match.edge")}</th><th>{t("match.ev")}</th><th>{t("match.evCons")}</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const a = r.assessment;
                  return (
                    <tr key={r.key}>
                      <td className="font-medium text-slate-100">{t(`mk.${r.key}`)}</td>
                      <td className="num">{fmt.pct(r.modelProb)}</td>
                      <td className="num text-mute">{fmt.pct(r.fairMarketProb)}</td>
                      <td className="num">{r.bestOdds ? <>{fmt.num(r.bestOdds)} <span className="text-[10px] text-mute" dir="ltr">{r.bestBook}</span></> : "—"}</td>
                      <td className={clsx("num", a && (a.edge > 0 ? "text-emerald-400" : "text-rose-400"))} dir="ltr">{a ? fmt.signedPct(a.edge) : "—"}</td>
                      <td className={clsx("num font-semibold", a && (a.ev > 0 ? "text-emerald-400" : "text-rose-400"))} dir="ltr">{a ? fmt.signedPct(a.ev) : "—"}</td>
                      <td className={clsx("num", a && (a.conservativeEv > 0 ? "text-emerald-400" : "text-mute"))} dir="ltr">{a ? fmt.signedPct(a.conservativeEv) : "—"}</td>
                      <td>
                        {a && (
                          <span className={clsx("chip whitespace-nowrap", a.isValue ? "border-emerald-500/50 text-emerald-300" : a.reasonKey !== "value.noEdge" && !a.isValue ? "border-gold-400/50 text-gold-300" : "")}>
                            {t(a.reasonKey)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {margin !== null && <p className="mt-3 text-xs text-mute">{t("match.margin", { v: fmt.pct(margin) })}</p>}
          {uncertainty !== undefined && <p className="mt-1 text-xs text-mute">{t("match.uncertainty", { v: fmt.pct(uncertainty) })}</p>}
          <p className="mt-2 text-[11px] leading-relaxed text-mute">{t("value.evFormula")} · {t("disclaimer.ev")}</p>
        </>
      )}
    </Panel>
  );
}

// ---------------- stats ----------------
function StatRow({ label, h, a, digits = 2, lowerBetter }: { label: string; h: number | null; a: number | null; digits?: number; lowerBetter?: boolean }) {
  const { fmt } = useI18n();
  const total = (h ?? 0) + (a ?? 0) || 1;
  const hb = h !== null && a !== null && (lowerBetter ? h < a : h > a);
  const ab = h !== null && a !== null && (lowerBetter ? a < h : a > h);
  return (
    <div className="py-2">
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className={clsx("num", hb ? "font-semibold text-emerald-400" : "text-slate-300")}>{fmt.num(h, digits)}</span>
        <span className="text-xs text-mute">{label}</span>
        <span className={clsx("num", ab ? "font-semibold text-azure-400" : "text-slate-300")}>{fmt.num(a, digits)}</span>
      </div>
      <div className="flex h-1.5 gap-1" dir="ltr">
        <div className="flex flex-1 justify-end overflow-hidden rounded bg-ink-700"><div className="bg-emerald-500" style={{ width: `${((h ?? 0) / total) * 100}%` }} /></div>
        <div className="flex-1 overflow-hidden rounded bg-ink-700"><div className="h-full bg-azure-500" style={{ width: `${((a ?? 0) / total) * 100}%` }} /></div>
      </div>
    </div>
  );
}

function RecentList({ team, matches }: { team: TeamRef; matches: Match[] }) {
  const { fmt } = useI18n();
  if (!matches.length) return <p className="text-xs text-mute">—</p>;
  return (
    <ul className="divide-y divide-line/70 text-sm">
      {matches.map((m) => {
        const home = m.homeTeam.id === team.id;
        const opp = home ? m.awayTeam : m.homeTeam;
        const f = (home ? m.score.fullTime.home : m.score.fullTime.away)!;
        const g = (home ? m.score.fullTime.away : m.score.fullTime.home)!;
        const r = f > g ? "W" : f === g ? "D" : "L";
        return (
          <li key={m.id} className="flex items-center gap-2 py-1.5">
            <FormPills form={[r]} size="xs" />
            <span className="num w-14 shrink-0 text-[11px] text-mute">{fmt.date(m.utcDate)}</span>
            <span className="text-[10px] text-mute">{home ? "H" : "A"}</span>
            <Crest team={opp} size={18} />
            <span className="min-w-0 flex-1 truncate">{opp.shortName}</span>
            <span className="num font-semibold" dir="ltr">{f}-{g}</span>
            <span className="hidden text-[10px] text-mute sm:inline" dir="ltr">{m.competition.code}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function StatsSection({ home, away, homeTeam, awayTeam, prediction, h2h, h2hMaybe }: {
  home: TeamStatSummary; away: TeamStatSummary; homeTeam: TeamRef; awayTeam: TeamRef; prediction: PredictionResult; h2h: Match[]; h2hMaybe: Maybe<unknown>;
}) {
  const { t, fmt } = useI18n();
  const hasXg = home.xgFor !== null && away.xgFor !== null;
  const chart = [
    { metric: t("stat.avgScored"), home: +home.avgFor.toFixed(2), away: +away.avgFor.toFixed(2) },
    { metric: t("stat.avgConceded"), home: +home.avgAgainst.toFixed(2), away: +away.avgAgainst.toFixed(2) },
    ...(hasXg ? [{ metric: "xG", home: +home.xgFor!.toFixed(2), away: +away.xgFor!.toFixed(2) }, { metric: "xGA", home: +home.xgAgainst!.toFixed(2), away: +away.xgAgainst!.toFixed(2) }] : []),
    { metric: t("match.attack"), home: +prediction.ratings.home.attack.toFixed(2), away: +prediction.ratings.away.attack.toFixed(2) },
    { metric: t("match.defence"), home: +prediction.ratings.home.defence.toFixed(2), away: +prediction.ratings.away.defence.toFixed(2) },
  ];
  const trend = (s: TeamStatSummary, id: string) =>
    [...s.recent].reverse().map((m, i) => {
      const isHome = m.homeTeam.id === id;
      const xg = m.stats?.xg ? (isHome ? m.stats.xg.home : m.stats.xg.away) : null;
      return { label: `${i + 1}`, for: (isHome ? m.score.fullTime.home : m.score.fullTime.away)!, against: (isHome ? m.score.fullTime.away : m.score.fullTime.home)!, xg };
    });
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={t("match.stats")} right={<span className="text-[11px] text-mute">{t("match.statsWindow", { n: Math.max(home.matches, away.matches) })}</span>}>
          <div className="mb-2 flex items-center justify-between text-xs font-semibold">
            <span className="flex items-center gap-1.5 text-emerald-400"><Crest team={homeTeam} size={18} />{homeTeam.shortName}</span>
            <span className="flex items-center gap-1.5 text-azure-400">{awayTeam.shortName}<Crest team={awayTeam} size={18} /></span>
          </div>
          <StatRow label={t("stat.xg")} h={home.xgFor} a={away.xgFor} />
          <StatRow label={t("stat.xga")} h={home.xgAgainst} a={away.xgAgainst} lowerBetter />
          <StatRow label={t("stat.shots")} h={home.shots} a={away.shots} digits={1} />
          <StatRow label={t("stat.sot")} h={home.shotsOnTarget} a={away.shotsOnTarget} digits={1} />
          <StatRow label={t("stat.possession")} h={home.possession} a={away.possession} digits={1} />
          {!hasXg && <UnavailableNote className="my-2" u={{ reasonKey: "stat.xgUnavailable" }} />}
          <StatRow label={t("stat.avgScored")} h={home.avgFor} a={away.avgFor} />
          <StatRow label={t("stat.avgConceded")} h={home.avgAgainst} a={away.avgAgainst} lowerBetter />
          <StatRow label={t("stat.scored")} h={home.goalsFor} a={away.goalsFor} digits={0} />
          <StatRow label={t("stat.conceded")} h={home.goalsAgainst} a={away.goalsAgainst} digits={0} lowerBetter />
          <StatRow label={t("stat.cleanSheets")} h={home.cleanSheets} a={away.cleanSheets} digits={0} />
          <StatRow label={t("stat.over25")} h={home.over25Rate * 100} a={away.over25Rate * 100} digits={0} />
          <StatRow label={t("stat.btts")} h={home.bttsRate * 100} a={away.bttsRate * 100} digits={0} />
          <StatRow label={`${t("stat.homePerf")} — ${t("stat.avgScored")}`} h={home.home.avgFor} a={away.home.avgFor} />
          <StatRow label={`${t("stat.awayPerf")} — ${t("stat.avgScored")}`} h={home.away.avgFor} a={away.away.avgFor} />
          <StatRow label={t("stat.leaguePos")} h={home.standing?.position ?? null} a={away.standing?.position ?? null} digits={0} lowerBetter />
        </Panel>
        <div className="space-y-6">
          <Panel title={t("match.ratings")}>
            <CompareBarChart data={chart} homeLabel={homeTeam.shortName} awayLabel={awayTeam.shortName} />
            <p className="mt-2 text-[11px] text-mute">{t("match.defenceHint")} · {t("match.homeAdv")}: <span className="num">×{fmt.num(prediction.ratings.homeAdvantage)}</span></p>
          </Panel>
          <Panel title={t("common.form")}>
            {([[homeTeam, home], [awayTeam, away]] as const).map(([tm, s]) => (
              <div key={tm.id} className="mb-3 last:mb-0">
                <div className="mb-1 flex items-center gap-2 text-sm font-medium"><Crest team={tm} size={18} />{tm.shortName}</div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-mute">
                  <span>{t("stat.last5")}: <FormPills form={s.last5} /></span>
                  <span>{t("stat.last10")}: <FormPills form={s.last10} size="xs" /></span>
                </div>
              </div>
            ))}
          </Panel>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {([[homeTeam, home], [awayTeam, away]] as const).map(([tm, s]) => (
          <Panel key={tm.id} title={<span className="flex items-center gap-2"><Crest team={tm} size={20} />{t("match.recent")} — {tm.shortName}</span>}
            right={<Link className="link text-xs" href={`/teams/${encodeURIComponent(tm.id)}`}>{t("common.details")}</Link>}>
            <GoalsTrendChart data={trend(s, tm.id)} />
            <div className="mt-3"><RecentList team={tm} matches={s.recent} /></div>
          </Panel>
        ))}
      </div>
      <Panel title={t("match.h2h")} right={!isUnavailable(h2hMaybe) ? <SourceBadge source={h2hMaybe.source} /> : undefined}>
        {isUnavailable(h2hMaybe) ? <UnavailableNote u={h2hMaybe} /> : h2h.length === 0 ? <p className="text-sm text-mute">{t("match.h2hNone")}</p> : (
          <>
            <div className="mb-3 grid grid-cols-3 gap-2 text-center">
              {(() => {
                let hw = 0, d = 0, aw = 0;
                for (const m of h2h) {
                  const gh = m.score.fullTime.home!, ga = m.score.fullTime.away!;
                  const homeGoals = m.homeTeam.id === homeTeam.id ? gh : ga, awayGoals = m.homeTeam.id === homeTeam.id ? ga : gh;
                  if (homeGoals > awayGoals) hw++; else if (homeGoals === awayGoals) d++; else aw++;
                }
                return [[homeTeam.shortName, hw, "text-emerald-400"], [t("common.draw"), d, "text-slate-200"], [awayTeam.shortName, aw, "text-azure-400"]].map(([l, v, c]) => (
                  <div key={String(l)} className="rounded-md bg-ink-800 p-2"><div className={`num text-xl font-semibold ${c}`}>{v}</div><div className="truncate text-[11px] text-mute">{l}</div></div>
                ));
              })()}
            </div>
            <ul className="divide-y divide-line/70 text-sm">
              {h2h.map((m) => (
                <li key={m.id} className="flex items-center gap-2 py-1.5">
                  <span className="num w-24 shrink-0 text-[11px] text-mute">{fmt.date(m.utcDate)}</span>
                  <span className="min-w-0 flex-1 truncate text-end">{m.homeTeam.shortName}</span>
                  <span className="num rounded bg-ink-800 px-2 font-semibold" dir="ltr">{m.score.fullTime.home}-{m.score.fullTime.away}</span>
                  <span className="min-w-0 flex-1 truncate">{m.awayTeam.shortName}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-mute">{t("match.h2hNote", { v: fmt.num(prediction.h2hAdjustment, 3) })}</p>
          </>
        )}
      </Panel>
    </div>
  );
}

// ---------------- team intelligence ----------------
export function TeamIntel({ homeTeam, awayTeam, availability, lineups, news, context, squads, stats }: {
  homeTeam: TeamRef; awayTeam: TeamRef;
  availability: Maybe<{ home: PlayerAvailability[]; away: PlayerAvailability[] }>;
  lineups: Maybe<Lineup[]>; news: Maybe<NewsItem[]>;
  context: { home: TeamContext; away: TeamContext };
  squads: [Maybe<TeamDetails>, Maybe<TeamDetails>];
  stats: { home: TeamStatSummary; away: TeamStatSummary };
}) {
  const { t, fmt } = useI18n();
  const ctxRow = (label: string, h: number | null, a: number | null) => (
    <tr><td className="text-slate-300">{label}</td><td className="num text-center">{h ?? "—"}</td><td className="num text-center">{a ?? "—"}</td></tr>
  );
  return (
    <div className="space-y-6">
      <p className="rounded-lg border border-line bg-ink-850/60 px-3 py-2 text-xs text-mute">{t("intel.moraleNote")}</p>
      <Panel title={t("intel.availability")} right={!isUnavailable(availability) ? <SourceBadge source={availability.source} /> : undefined}>
        {isUnavailable(availability) ? <UnavailableNote u={availability} /> : (
          <div className="grid gap-4 md:grid-cols-2">
            {([[homeTeam, availability.data.home], [awayTeam, availability.data.away]] as const).map(([tm, list]) => (
              <div key={tm.id}>
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Crest team={tm} size={18} />{tm.shortName}</div>
                {list.length === 0 ? <p className="text-xs text-mute">{t("intel.noAbsences")}</p> : (
                  <ul className="space-y-1.5">
                    {list.map((p, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-2 rounded-md bg-ink-800 px-2.5 py-1.5 text-sm">
                        <span className={clsx("chip", p.type === "SUSPENSION" ? "text-gold-300" : p.type === "DOUBTFUL" ? "text-azure-300" : "text-rose-400")}>{t(`intel.type.${p.type}`)}</span>
                        <span className="font-medium" dir="auto">{p.player}</span>
                        {p.position && <span className="text-[11px] text-mute">{p.position}</span>}
                        <span className="text-[11px] text-mute">— {p.reason}</span>
                        {p.expectedReturn && <span className="ms-auto text-[11px] text-mute">{t("intel.return")}: {p.expectedReturn}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={t("intel.lineups")} right={!isUnavailable(lineups) ? <SourceBadge source={lineups.source} /> : undefined}>
          {isUnavailable(lineups) ? <UnavailableNote u={lineups} /> : (
            <div className="grid gap-4 sm:grid-cols-2">
              {lineups.data.map((l) => (
                <div key={l.team.id}>
                  <div className="mb-2 flex items-center justify-between text-sm font-semibold">
                    <span>{l.team.shortName} {l.formation && <span className="num text-xs text-mute">({l.formation})</span>}</span>
                    <span className="chip">{l.confirmed ? t("intel.confirmed") : t("intel.expected")}</span>
                  </div>
                  <ol className="space-y-0.5 text-sm">{l.startXI.map((p, i) => <li key={i} className="flex gap-2"><span className="num w-6 text-mute">{p.number ?? ""}</span><span dir="auto">{p.name}</span><span className="text-[11px] text-mute">{p.position}</span></li>)}</ol>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel title={t("intel.squad")}>
          <div className="space-y-3">
            {([[homeTeam, squads[0]], [awayTeam, squads[1]]] as const).map(([tm, sq]) => (
              <div key={tm.id}>
                <div className="mb-1 flex items-center gap-2 text-sm font-semibold"><Crest team={tm} size={18} />{tm.shortName}</div>
                {isUnavailable(sq) ? <UnavailableNote u={sq} /> : sq.data.squad.length === 0 ? <UnavailableNote u={{ reasonKey: "common.notSupplied", provider: sq.source.provider }} /> : (
                  <div className="text-xs text-mute">
                    {t("intel.squadSize", { n: sq.data.squad.length })}:{" "}
                    {Object.entries(sq.data.squad.reduce<Record<string, number>>((acc, p) => { const k = p.position ?? "?"; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {}))
                      .map(([k, v]) => `${k} ${v}`).join(" · ")}
                    {sq.data.coach && <span> · {t("teams.coach")}: <span className="text-slate-300">{sq.data.coach}</span></span>}
                    <div className="mt-1"><SourceBadge source={sq.source} /></div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <Panel title={t("intel.context")}>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th /><th className="text-center">{homeTeam.shortName}</th><th className="text-center">{awayTeam.shortName}</th></tr></thead>
            <tbody>
              <tr>
                <td className="text-slate-300">{t("stat.leaguePos")}</td>
                <td className="num text-center">{stats.home.standing ? `${stats.home.standing.position} (${stats.home.standing.points})` : "—"}</td>
                <td className="num text-center">{stats.away.standing ? `${stats.away.standing.position} (${stats.away.standing.points})` : "—"}</td>
              </tr>
              <tr>
                <td className="text-slate-300">{t("intel.context")}</td>
                <td className="text-center text-xs">{context.home.situationKey ? t(context.home.situationKey) : "—"}</td>
                <td className="text-center text-xs">{context.away.situationKey ? t(context.away.situationKey) : "—"}</td>
              </tr>
              {ctxRow(t("intel.fromTop"), context.home.pointsFromTop, context.away.pointsFromTop)}
              {ctxRow(t("intel.fromEurope"), context.home.pointsFromEurope, context.away.pointsFromEurope)}
              {ctxRow(t("intel.aboveDrop"), context.home.pointsAboveDrop, context.away.pointsAboveDrop)}
              {ctxRow(t("intel.rest"), context.home.restDays, context.away.restDays)}
              {ctxRow(t("intel.congestion14"), context.home.matchesLast14, context.away.matchesLast14)}
              {ctxRow(t("intel.congestion30"), context.home.matchesLast30, context.away.matchesLast30)}
              {ctxRow(t("intel.nextMatch"), context.home.nextMatchDays, context.away.nextMatchDays)}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title={t("intel.news")}>
        {isUnavailable(news) ? <UnavailableNote u={news} /> : (
          <ul className="space-y-2 text-sm">
            {news.data.map((n, i) => (
              <li key={i}>
                <a className="link" href={n.url} target="_blank" rel="noopener noreferrer nofollow">{n.title}</a>
                <div className="text-[11px] text-mute">{n.source} · {fmt.dateTime(n.publishedAt)}</div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

// ---------------- report ----------------
export function ReportView({ sections, demo }: { sections: ReportSection[]; demo: boolean }) {
  const { t } = useI18n();
  return (
    <Panel title={<span className="flex items-center gap-2">{t("report.title")} {demo && <DemoBadge />}</span>}>
      <p className="mb-5 rounded-lg border border-azure-500/30 bg-azure-500/5 px-3 py-2 text-xs text-azure-300">{t("report.disclaimer")}</p>
      <div className="grid gap-5 md:grid-cols-2">
        {sections.map((s) => (
          <article key={s.id} className={clsx("rounded-lg border border-line bg-ink-850/60 p-4", s.id === "uncertainty" && "md:col-span-2 border-gold-400/30")}>
            <h3 className="mb-2 text-sm font-semibold text-white">{s.title}</h3>
            <ul className="list-disc space-y-1.5 ps-5 text-sm leading-relaxed text-slate-300 marker:text-emerald-500">
              {s.bullets.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          </article>
        ))}
      </div>
    </Panel>
  );
}

export function RatingBars({ p, homeTeam, awayTeam }: { p: PredictionResult; homeTeam: TeamRef; awayTeam: TeamRef }) {
  const { t, fmt } = useI18n();
  const rows: [string, number, number][] = [
    [t("match.attack"), p.ratings.home.attack, p.ratings.away.attack],
    [t("match.defence"), p.ratings.home.defence, p.ratings.away.defence],
  ];
  return (
    <div className="space-y-3">
      {rows.map(([label, h, a]) => (
        <div key={label}>
          <div className="eyebrow mb-1">{label}</div>
          <div className="grid grid-cols-[80px_1fr_44px] items-center gap-2 text-xs"><span className="truncate">{homeTeam.shortName}</span><MiniBar value={h / 2} /><span className="num text-end">{fmt.num(h)}</span></div>
          <div className="mt-1 grid grid-cols-[80px_1fr_44px] items-center gap-2 text-xs"><span className="truncate">{awayTeam.shortName}</span><MiniBar value={a / 2} tone="azure" /><span className="num text-end">{fmt.num(a)}</span></div>
        </div>
      ))}
      <p className="text-[11px] text-mute">{t("match.defenceHint")}</p>
    </div>
  );
}
