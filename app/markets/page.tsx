import clsx from "clsx";
import Link from "next/link";
import { MarketTables } from "@/components/match/MarketTables";
import { MarketVsModel } from "@/components/match/Sections";
import { Crest, Panel, PageHeader, ProbBar, QualityBadge, SourceBadge } from "@/components/ui";
import { addDaysYmd, ymdInTz } from "@/lib/dates";
import { getI18n } from "@/lib/i18n/server";
import { analyseMatch } from "@/services/analysis";
import { getMatchesBetween } from "@/services/matches";
import { quickPredictions } from "@/services/quick";

export const dynamic = "force-dynamic";
// allow waiting out a free-tier rate-limit window instead of failing (Vercel Hobby max is 60s)
export const maxDuration = 60;
export const metadata = { title: "Betting Markets" };

export default async function MarketsPage({ searchParams }: { searchParams: Promise<{ match?: string }> }) {
  const { match: sel } = await searchParams;
  const { t, fmt, tz } = await getI18n();
  const today = ymdInTz(new Date(), tz);
  const feed = await getMatchesBetween(today, addDaysYmd(today, 3), tz);
  const upcoming = feed.matches.filter((m) => ["SCHEDULED", "TIMED"].includes(m.status));
  const preds = await quickPredictions(upcoming);
  const selectedId = sel && /^[A-Za-z0-9-]{1,64}$/.test(sel) ? sel : upcoming[0]?.id;
  const a = selectedId ? await analyseMatch(selectedId).catch(() => null) : null;

  return (
    <>
      <PageHeader title={t("markets.title")} subtitle={t("markets.subtitle")} right={<SourceBadge source={feed.source} />} />
      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <Panel title={t("markets.selectMatch")} className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
          {upcoming.length === 0 ? <p className="text-sm text-mute">{t("dash.noMatches")}</p> : (
            <ul className="space-y-1.5">
              {upcoming.map((m) => {
                const p = preds.get(m.id);
                return (
                  <li key={m.id}>
                    <Link href={`/markets?match=${m.id}`} aria-current={m.id === selectedId ? "true" : undefined}
                      className={clsx("block rounded-lg border p-2.5 text-xs transition", m.id === selectedId ? "border-emerald-500/50 bg-emerald-500/5" : "border-line hover:border-emerald-500/30")}>
                      <div className="flex items-center justify-between text-[10px] text-mute"><span dir="ltr">{m.competition.code}</span><span className="num">{fmt.date(m.utcDate)} {fmt.time(m.utcDate)}</span></div>
                      <div className="mt-1 flex items-center gap-1.5 font-medium"><Crest team={m.homeTeam} size={16} /><span className="truncate">{m.homeTeam.shortName}</span><span className="text-mute">–</span><span className="truncate">{m.awayTeam.shortName}</span></div>
                      {p && <div className="mt-1.5"><ProbBar {...p.oneXTwo} compact /></div>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        <div className="min-w-0 space-y-6">
          {!a ? <p className="panel p-6 text-sm text-mute">{t("markets.pick")}</p> : (
            <>
              <Panel title={<Link className="hover:text-emerald-300" href={`/matches/${a.match.data.id}`}>{a.match.data.homeTeam.name} {t("common.vs")} {a.match.data.awayTeam.name}</Link>}
                right={<QualityBadge q={a.prediction.dataQuality} />}>
                <ProbBar {...a.prediction.oneXTwo} />
                <p className="mt-3 text-[11px] text-mute">{t("match.xgModel")}: <span className="num">{fmt.num(a.prediction.lambdaHome)} – {fmt.num(a.prediction.lambdaAway)}</span> · <span dir="ltr">{a.prediction.modelVersion}</span></p>
              </Panel>
              <MarketVsModel rows={a.market} margin={a.bookmakerMargin} odds={a.odds} uncertainty={a.prediction.probUncertainty} />
              <MarketTables p={a.prediction} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
