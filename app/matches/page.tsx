import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { MatchCard } from "@/components/MatchCard";
import { Notice, Panel, PageHeader, SourceBadge } from "@/components/ui";
import { COMPETITIONS, isValidCompetition } from "@/lib/competitions";
import { addDaysYmd, isYmd, ymdInTz } from "@/lib/dates";
import { getI18n } from "@/lib/i18n/server";
import { applyFilters, getMatchesBetween } from "@/services/matches";
import { quickPredictions } from "@/services/quick";

export const dynamic = "force-dynamic";
export const metadata = { title: "Matches" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function MatchesPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { t, fmt, tz } = await getI18n();
  const today = ymdInTz(new Date(), tz);
  const rawDate = one(sp.date);
  const date = isYmd(rawDate) && Math.abs((Date.parse(rawDate) - Date.parse(today)) / 864e5) <= 60 ? rawDate : today;
  const league = one(sp.league);
  const filters = {
    league: league && isValidCompetition(league) ? league.toUpperCase() : undefined,
    country: one(sp.country)?.slice(0, 40) || undefined,
    q: one(sp.q)?.slice(0, 60) || undefined,
    status: ["live", "finished", "scheduled"].includes(one(sp.status) ?? "") ? one(sp.status) : undefined,
  };
  const feed = await getMatchesBetween(date, date, tz);
  const matches = applyFilters(feed.matches, filters);
  const preds = await quickPredictions(matches);
  const countries = [...new Set(COMPETITIONS.map((c) => c.country))];
  const qs = (d: string) => {
    const p = new URLSearchParams();
    p.set("date", d);
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    return `/matches?${p.toString()}`;
  };
  const byComp = new Map<string, typeof matches>();
  for (const m of matches) byComp.set(m.competition.name, [...(byComp.get(m.competition.name) ?? []), m]);

  return (
    <>
      <PageHeader title={t("nav.today")} subtitle={fmt.dateLong(date + "T12:00:00Z")} right={<SourceBadge source={feed.source} />} />
      <Panel className="mb-6" title={t("filters.title")}>
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6" role="search">
          <label className="lg:col-span-1">
            <span className="eyebrow mb-1 block">{t("common.date")}</span>
            <input className="input" type="date" name="date" defaultValue={date} />
          </label>
          <label>
            <span className="eyebrow mb-1 block">{t("common.league")}</span>
            <select className="input" name="league" defaultValue={filters.league ?? ""}>
              <option value="">{t("filters.allLeagues")}</option>
              {COMPETITIONS.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </label>
          <label>
            <span className="eyebrow mb-1 block">{t("common.country")}</span>
            <select className="input" name="country" defaultValue={filters.country ?? ""}>
              <option value="">{t("filters.allCountries")}</option>
              {countries.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>
            <span className="eyebrow mb-1 block">{t("common.status")}</span>
            <select className="input" name="status" defaultValue={filters.status ?? ""}>
              <option value="">{t("filters.allStatus")}</option>
              <option value="live">{t("common.live")}</option>
              <option value="scheduled">{t("common.scheduled")}</option>
              <option value="finished">{t("common.finished")}</option>
            </select>
          </label>
          <label>
            <span className="eyebrow mb-1 block">{t("common.team")}</span>
            <input className="input" type="search" name="q" maxLength={60} placeholder={t("filters.team")} defaultValue={filters.q ?? ""} />
          </label>
          <div className="flex items-end gap-2">
            <button className="btn btn-primary flex-1" type="submit">{t("filters.apply")}</button>
            <Link className="btn" href="/matches">{t("filters.clear")}</Link>
          </div>
        </form>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <Link className="btn px-2 py-1" href={qs(addDaysYmd(date, -1))} aria-label="previous day"><ChevronLeft className="h-4 w-4 rtl:-scale-x-100" /></Link>
          <Link className={`btn px-3 py-1 ${date === today ? "btn-primary" : ""}`} href={qs(today)}>{t("common.today")}</Link>
          <Link className={`btn px-3 py-1 ${date === addDaysYmd(today, 1) ? "btn-primary" : ""}`} href={qs(addDaysYmd(today, 1))}>{t("common.tomorrow")}</Link>
          <Link className="btn px-2 py-1" href={qs(addDaysYmd(date, 1))} aria-label="next day"><ChevronRight className="h-4 w-4 rtl:-scale-x-100" /></Link>
          <span className="ms-auto text-xs text-mute">{t("filters.results", { n: matches.length })}</span>
        </div>
      </Panel>
      {feed.error && <div className="mb-4"><Notice>{t(feed.errorKey ?? "provider.error")}</Notice></div>}
      {filters.status === "live" && !feed.liveSupported && <div className="mb-4"><Notice tone="azure">{t("demo.noLive")}</Notice></div>}
      {matches.length === 0 ? (
        <p className="panel p-6 text-center text-sm text-mute">{t("dash.noMatches")}</p>
      ) : (
        <div className="space-y-6">
          {[...byComp.entries()].map(([name, ms]) => (
            <Panel key={name} title={<span dir="ltr">{name}</span>} right={<span className="chip">{ms[0].competition.country}</span>}>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {ms.map((m) => <MatchCard key={m.id} match={m} probs={preds.get(m.id)?.oneXTwo} />)}
              </div>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
