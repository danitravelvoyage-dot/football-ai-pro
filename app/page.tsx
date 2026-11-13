import { ArrowUpRight, Radio } from "lucide-react";
import Link from "next/link";
import { MatchCard } from "@/components/MatchCard";
import { DemoBadge, Kpi, Notice, Panel, PageHeader, SourceBadge } from "@/components/ui";
import { COMPETITIONS } from "@/lib/competitions";
import { addDaysYmd, ymdInTz } from "@/lib/dates";
import { getI18n } from "@/lib/i18n/server";
import { getStore } from "@/database/store";
import { getMatchesBetween, LIVE_STATUSES } from "@/services/matches";
import { quickPredictions, scanMarkets } from "@/services/quick";

export const dynamic = "force-dynamic";
// allow waiting out a free-tier rate-limit window instead of failing (Vercel Hobby max is 60s)
export const maxDuration = 60;

export default async function Dashboard() {
  const { t, fmt, tz } = await getI18n();
  const today = ymdInTz(new Date(), tz);
  const tomorrow = addDaysYmd(today, 1);
  const feed = await getMatchesBetween(today, addDaysYmd(today, 10), tz);
  const byDay = (d: string) => feed.matches.filter((m) => ymdInTz(new Date(m.utcDate), tz) === d);
  const todays = byDay(today);
  const tomorrows = byDay(tomorrow);
  const live = feed.matches.filter((m) => LIVE_STATUSES.has(m.status));
  const later = feed.matches.filter((m) => ymdInTz(new Date(m.utcDate), tz) > tomorrow);
  const [preds, scan, tracked] = await Promise.all([
    quickPredictions([...todays, ...tomorrows, ...later.slice(0, 30)]),
    scanMarkets([...todays, ...tomorrows]),
    getStore().list().then((x) => x.length).catch(() => 0),
  ]);
  const valueToday = scan.rows.filter((r) => r.row.assessment?.isValue).length;
  const edges = scan.rows.filter((r) => r.row.assessment!.ev > 0).slice(0, 6); // already sorted by EV desc
  const comps = COMPETITIONS.map((c) => ({ ...c, n: feed.matches.filter((m) => m.competition.code === c.code).length }));

  const grid = (ms: typeof todays) =>
    ms.length ? (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {ms.map((m) => {
          const p = preds.get(m.id);
          return <MatchCard key={m.id} match={m} probs={p?.oneXTwo} />;
        })}
      </div>
    ) : (
      <p className="text-sm text-mute">{t("dash.noMatches")}</p>
    );

  return (
    <>
      <PageHeader title={t("dash.title")} subtitle={t("dash.subtitle")} right={<SourceBadge source={feed.source} />} />
      {feed.error && <div className="mb-4"><Notice>{t(feed.errorKey ?? "provider.error")}</Notice></div>}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("dash.kpi.matches")} value={fmt.int(feed.matches.length)} />
        <Kpi label={t("dash.kpi.leagues")} value={fmt.int(COMPETITIONS.length)} tone="azure" />
        <Kpi label={t("dash.kpi.value")} value={scan.oddsAvailable ? fmt.int(valueToday) : "—"} tone="gold" hint={scan.oddsReason ? t(scan.oddsReason) : undefined} />
        <Kpi label={t("dash.kpi.tracked")} value={fmt.int(tracked)} tone="slate" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          <Panel title={<span className="flex items-center gap-2"><Radio className="h-4 w-4 text-rose-400" aria-hidden />{t("dash.live")}</span>}>
            {!feed.liveSupported ? (
              <p className="text-sm text-mute">{feed.source.demo ? t("demo.noLive") : t("dash.liveUnsupported")}</p>
            ) : live.length ? grid(live) : <p className="text-sm text-mute">{t("dash.noMatches")}</p>}
          </Panel>
          <Panel title={`${t("dash.today")} · ${fmt.date(today + "T12:00:00Z")}`} right={<Link className="link text-xs" href="/matches">{t("common.viewAll")}</Link>}>
            {grid(todays)}
          </Panel>
          <Panel title={`${t("dash.tomorrow")} · ${fmt.date(tomorrow + "T12:00:00Z")}`} right={<Link className="link text-xs" href={`/matches?date=${tomorrow}`}>{t("common.viewAll")}</Link>}>
            {grid(tomorrows)}
          </Panel>
          <Panel title={t("dash.upcoming")}>{grid(later.slice(0, 30))}</Panel>
        </div>

        <aside className="space-y-6">
          <Panel title={t("dash.topEdges")}>
            {edges.length ? (
              <ul className="space-y-3">
                {edges.map(({ match, row, demo }) => (
                  <li key={match.id + row.key}>
                    <Link href={`/matches/${match.id}`} className="block rounded-lg border border-line bg-ink-850 p-3 transition hover:border-emerald-500/40">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate font-medium text-slate-100">{match.homeTeam.shortName} – {match.awayTeam.shortName}</span>
                        {demo && <DemoBadge />}
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-[11px] text-mute">
                        <span>{t(`mk.${row.key}`)} @ <span className="num text-slate-300">{fmt.num(row.bestOdds)}</span></span>
                        <span className={`num font-semibold ${row.assessment!.ev > 0 ? "text-emerald-400" : "text-rose-400"}`} dir="ltr">EV {fmt.signedPct(row.assessment!.ev)}</span>
                      </div>
                      <div className={`mt-1 text-[10px] ${row.assessment!.isValue ? "text-emerald-300" : "text-gold-300"}`}>{t(row.assessment!.reasonKey)}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-mute">{scan.oddsReason ? t(scan.oddsReason) : t("dash.topEdgesEmpty")}</p>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-mute">{t("disclaimer.ev")}</p>
          </Panel>
          <Panel title={t("dash.competitions")}>
            <ul className="space-y-1.5">
              {comps.map((c) => (
                <li key={c.code}>
                  <Link href={`/leagues/${c.code}`} className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-ink-800">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: c.color }} aria-hidden />
                      <span dir="ltr">{c.name}</span>
                    </span>
                    <span className="flex items-center gap-1 text-xs text-mute"><span className="num">{c.n}</span><ArrowUpRight className="h-3 w-3 rtl:-scale-x-100" aria-hidden /></span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
          <p className="text-[11px] leading-relaxed text-mute">{t("disclaimer.short")}</p>
        </aside>
      </div>
    </>
  );
}
