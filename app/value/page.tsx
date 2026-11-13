import clsx from "clsx";
import Link from "next/link";
import { EvChart } from "@/components/charts";
import { DemoBadge, Notice, Panel, PageHeader } from "@/components/ui";
import { ValueCalculator } from "@/components/ValueCalculator";
import { addDaysYmd, ymdInTz } from "@/lib/dates";
import { getI18n } from "@/lib/i18n/server";
import { getMatchesBetween } from "@/services/matches";
import { scanMarkets } from "@/services/quick";

export const dynamic = "force-dynamic";
export const metadata = { title: "Value Bets" };

export default async function ValuePage({ searchParams }: { searchParams: Promise<{ only?: string }> }) {
  const { only } = await searchParams;
  const onlyValue = only === "1";
  const { t, fmt, tz } = await getI18n();
  const today = ymdInTz(new Date(), tz);
  const feed = await getMatchesBetween(today, addDaysYmd(today, 3), tz);
  const scan = await scanMarkets(feed.matches);
  const rows = (onlyValue ? scan.rows.filter((r) => r.row.assessment!.isValue) : scan.rows).slice(0, 80);
  const chart = scan.rows.slice(0, 10).map((r) => ({ name: `${r.match.homeTeam.tla}-${r.match.awayTeam.tla} ${r.row.key}`, ev: +(r.row.assessment!.ev * 100).toFixed(2) }));

  return (
    <>
      <PageHeader title={t("value.title")} subtitle={t("value.subtitle")} />
      <div className="mb-6"><Notice>{t("disclaimer.ev")}</Notice></div>
      <Panel title={t("value.calculator")} className="mb-6"><ValueCalculator /></Panel>
      <Panel title={t("value.scanner")} right={
        <Link href={onlyValue ? "/value" : "/value?only=1"} className={clsx("btn px-2.5 py-1 text-xs", onlyValue && "btn-primary")} aria-pressed={onlyValue}>{t("value.onlyValue")}</Link>
      }>
        <p className="mb-4 text-xs text-mute">{t("value.scannerSub")} {t("value.evFormula")}</p>
        {scan.oddsReason && <p className="mb-4 text-xs text-gold-300">{t(scan.oddsReason)}</p>}
        {chart.length > 0 && <div className="mb-4"><EvChart data={chart} /></div>}
        {rows.length === 0 ? <p className="text-sm text-mute">{t("value.noRows")}</p> : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>{t("common.matches")}</th><th>{t("value.selection")}</th><th>{t("common.model")}</th><th>{t("match.fairProb")}</th><th>{t("match.bestOdds")}</th><th>{t("match.ev")}</th><th>{t("match.evCons")}</th><th>{t("value.quality")}</th><th /></tr>
              </thead>
              <tbody>
                {rows.map(({ match, row, quality, demo }) => {
                  const a = row.assessment!;
                  return (
                    <tr key={match.id + row.key}>
                      <td><Link className="hover:text-emerald-300" href={`/matches/${match.id}`}>{match.homeTeam.shortName} – {match.awayTeam.shortName}</Link><div className="num text-[10px] text-mute">{fmt.date(match.utcDate)} {fmt.time(match.utcDate)} · <span dir="ltr">{match.competition.code}</span></div></td>
                      <td>{t(`mk.${row.key}`)}</td>
                      <td className="num">{fmt.pct(row.modelProb)}</td>
                      <td className="num text-mute">{fmt.pct(row.fairMarketProb)}</td>
                      <td className="num">{fmt.num(row.bestOdds)} {demo && <DemoBadge />}</td>
                      <td className={clsx("num font-semibold", a.ev > 0 ? "text-emerald-400" : "text-rose-400")} dir="ltr">{fmt.signedPct(a.ev)}</td>
                      <td className={clsx("num", a.conservativeEv > 0 ? "text-emerald-400" : "text-mute")} dir="ltr">{fmt.signedPct(a.conservativeEv)}</td>
                      <td className="num text-xs">{fmt.pct(quality, 0)}</td>
                      <td><span className={clsx("chip whitespace-nowrap", a.isValue ? "border-emerald-500/50 text-emerald-300" : a.reasonKey !== "value.noEdge" && !a.isValue ? "text-gold-300" : "")}>{t(a.reasonKey)}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
