import clsx from "clsx";
import Link from "next/link";
import { DemoBadge, Kpi, Panel, PageHeader } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { listPredictions } from "@/services/predictions";

export const dynamic = "force-dynamic";
// allow waiting out a free-tier rate-limit window instead of failing (Vercel Hobby max is 60s)
export const maxDuration = 60;
export const metadata = { title: "Prediction History" };

export default async function HistoryPage() {
  const { t, fmt } = await getI18n();
  const { predictions, summary: s, store } = await listPredictions();
  return (
    <>
      <PageHeader title={t("history.title")} subtitle={t("history.subtitle")} right={<span className="chip">{t("history.store", { v: t(`history.store.${store}`) })}</span>} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label={t("history.accuracy")} value={fmt.pct(s.accuracy1x2)} hint={`${s.settled} ${t("history.settled")} · ${s.pending} ${t("history.pending")}`} />
        <Kpi label={t("history.hitRate")} value={fmt.pct(s.selectedHitRate)} tone="azure" />
        <Kpi label={t("history.brier")} value={fmt.num(s.brier, 3)} hint={t("history.lowerBetter")} tone="slate" />
        <Kpi label={t("history.logLoss")} value={fmt.num(s.logLoss, 3)} hint={t("history.lowerBetter")} tone="slate" />
        <Kpi label={t("history.roi")} value={fmt.signedPct(s.roi)} hint={`${s.staked} × 1u · P/L ${fmt.num(s.profit)}`} tone="gold" />
        <Kpi label={t("history.clv")} value={s.clv === null ? "—" : fmt.signedPct(s.clv)} hint={s.clv === null ? t("history.clvNa") : `n=${s.clvSamples}`} tone="gold" />
      </div>
      <Panel title={t("history.byMarket")} className="mb-6">
        <div className="grid gap-3 sm:grid-cols-3">
          {s.byMarket.map((g) => (
            <div key={g.group} className="rounded-lg bg-ink-800 p-3">
              <div className="eyebrow" dir="ltr">{g.group === "OU25" ? "O/U 2.5" : g.group}</div>
              <div className="num mt-1 text-xl font-semibold text-emerald-400">{fmt.pct(g.hitRate)}</div>
              <div className="text-[11px] text-mute">n = {g.n}</div>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title={t("history.title")}>
        {predictions.length === 0 ? <p className="text-sm text-mute">{t("history.empty")}</p> : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>{t("common.matches")}</th><th>{t("history.created")}</th><th>{t("history.selection")}</th><th>{t("history.probs")}</th><th>{t("history.oddsTaken")}</th><th>{t("common.model")}</th><th>{t("history.outcome")}</th><th>{t("history.pl")}</th></tr>
              </thead>
              <tbody>
                {predictions.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link className="hover:text-emerald-300" href={`/matches/${p.matchId}`}>{p.homeTeam} – {p.awayTeam}</Link>
                      <div className="num text-[10px] text-mute">{fmt.dateTime(p.kickoff)} · <span dir="ltr">{p.competitionCode}</span> {p.demo && <DemoBadge />}</div>
                    </td>
                    <td className="num text-xs text-mute">{fmt.dateTime(p.createdAt)}</td>
                    <td>{t(`mk.${p.selectedMarket}`)} <span className="num text-xs text-mute">({fmt.pct(p.selectedProb)})</span></td>
                    <td className="num text-xs" dir="ltr">{(p.probHome * 100).toFixed(1)} / {(p.probDraw * 100).toFixed(1)} / {(p.probAway * 100).toFixed(1)}</td>
                    <td className="num">{fmt.num(p.oddsTaken)}{p.closingOdds && <div className="text-[10px] text-mute">CL {fmt.num(p.closingOdds)}</div>}</td>
                    <td className="num text-[11px] text-mute" dir="ltr">{p.modelVersion}</td>
                    <td>
                      {p.status === "PENDING" ? <span className="chip">{t("history.pending")}</span> : p.status === "VOID" ? <span className="chip">{t("history.void")}</span> : (
                        <span className={clsx("chip", p.correct ? "border-emerald-500/50 text-emerald-300" : "border-rose-500/50 text-rose-400")}>
                          <span className="num" dir="ltr">{p.homeGoals}-{p.awayGoals}</span> · {p.correct ? t("history.won") : t("history.lost")}
                        </span>
                      )}
                    </td>
                    <td className={clsx("num", (p.profit ?? 0) > 0 ? "text-emerald-400" : (p.profit ?? 0) < 0 ? "text-rose-400" : "")} dir="ltr">{p.profit === null ? "—" : fmt.num(p.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
