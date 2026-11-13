import clsx from "clsx";
import Link from "next/link";
import { Crest, Panel, PageHeader, SourceBadge, UnavailableNote } from "@/components/ui";
import { COMPETITIONS, getCompetition } from "@/lib/competitions";
import { getI18n } from "@/lib/i18n/server";
import { computeStandings } from "@/services/providers/demo";
import { getFixturesProvider } from "@/services/providers";
import { isUnavailable, type StandingRow } from "@/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Teams" };

export default async function TeamsPage({ searchParams }: { searchParams: Promise<{ league?: string; q?: string }> }) {
  const sp = await searchParams;
  const { t } = await getI18n();
  const code = getCompetition(sp.league ?? "PL")?.code ?? "PL";
  const q = (sp.q ?? "").slice(0, 60).toLowerCase();
  const fx = getFixturesProvider();
  const st = await fx.getStandings(code);
  let rows: StandingRow[] = [];
  let source = isUnavailable(st) ? null : st.source;
  let reason = isUnavailable(st) ? st : null;
  if (!isUnavailable(st)) rows = st.data.total;
  else {
    // cups: derive the team list from competition fixtures
    const ms = await fx.getCompetitionMatches(code);
    if (!isUnavailable(ms)) {
      rows = computeStandings(ms.data);
      source = ms.source;
      reason = null;
    }
  }
  const filtered = rows.filter((r) => !q || r.team.name.toLowerCase().includes(q) || r.team.shortName.toLowerCase().includes(q));

  return (
    <>
      <PageHeader title={t("teams.title")} subtitle={t("teams.subtitle")} right={source ? <SourceBadge source={source} /> : undefined} />
      <div className="mb-4 flex flex-wrap gap-2">
        {COMPETITIONS.map((c) => (
          <Link key={c.code} href={`/teams?league=${c.code}`} className={clsx("btn px-3 py-1.5 text-xs", c.code === code && "btn-primary")} dir="ltr">{c.name}</Link>
        ))}
      </div>
      <Panel title={getCompetition(code)!.name} right={
        <form method="get" role="search" className="flex gap-2">
          <input type="hidden" name="league" value={code} />
          <input className="input w-44 py-1.5" type="search" name="q" defaultValue={sp.q ?? ""} placeholder={t("teams.search")} maxLength={60} aria-label={t("teams.search")} />
        </form>
      }>
        {reason ? <UnavailableNote u={reason} /> : filtered.length === 0 ? <p className="text-sm text-mute">{t("common.noData")}</p> : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((r) => (
              <li key={r.team.id}>
                <Link href={`/teams/${encodeURIComponent(r.team.id)}`} className="flex items-center gap-3 rounded-lg border border-line bg-ink-850 p-3 transition hover:border-emerald-500/40">
                  <Crest team={r.team} size={32} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-100">{r.team.name}</div>
                    <div className="num text-[11px] text-mute">#{r.position} · {r.points} {t("common.points")} · {r.goalsFor}:{r.goalsAgainst}</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
