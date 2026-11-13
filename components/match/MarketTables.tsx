"use client";
import clsx from "clsx";
import { fairOdds } from "@/lib/betting";
import { roundToHundred } from "@/models/poisson";
import type { OverUnder, PredictionResult } from "@/types";
import { useI18n } from "../I18nProvider";
import { ProbBar, UnavailableNote } from "../ui";

function OUTable({ rows, caption }: { rows: OverUnder[]; caption: string }) {
  const { t, fmt } = useI18n();
  return (
    <div className="overflow-x-auto">
      <table className="table-base">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr><th>{t("common.line")}</th><th>{t("common.over")}</th><th className="hidden sm:table-cell">{t("markets.fairOdds")}</th><th>{t("common.under")}</th><th className="hidden sm:table-cell">{t("markets.fairOdds")}</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const [o, u] = roundToHundred([r.over, r.under], 1);
            return (
              <tr key={r.line}>
                <td className="num font-semibold text-slate-100">{r.line.toFixed(1)}</td>
                <td className="num text-emerald-400">{o.toFixed(1)}%</td>
                <td className="num hidden text-mute sm:table-cell">{fmt.num(fairOdds(r.over))}</td>
                <td className="num text-azure-400">{u.toFixed(1)}%</td>
                <td className="num hidden text-mute sm:table-cell">{fmt.num(fairOdds(r.under))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Block({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx("rounded-lg border border-line bg-ink-850/60 p-3", className)}>
      <h3 className="eyebrow mb-3">{title}</h3>
      {children}
    </div>
  );
}

export function ScoreHeatmap({ p }: { p: PredictionResult }) {
  const { t, fmt } = useI18n();
  const max = 5;
  const top = Math.max(...p.scoreGrid.flat());
  return (
    <div className="overflow-x-auto">
      <table className="mx-auto border-separate border-spacing-1 text-center" dir="ltr">
        <caption className="mb-2 text-[11px] text-mute">{t("common.home")} ↓ · {t("common.away")} →</caption>
        <thead><tr><th />{Array.from({ length: max + 1 }, (_, a) => <th key={a} className="num text-[11px] text-mute">{a}</th>)}</tr></thead>
        <tbody>
          {Array.from({ length: max + 1 }, (_, h) => (
            <tr key={h}>
              <th className="num pe-1 text-[11px] text-mute">{h}</th>
              {Array.from({ length: max + 1 }, (_, a) => {
                const v = p.scoreGrid[h][a];
                const alpha = Math.min(1, v / top);
                return (
                  <td key={a} title={`${h}-${a}: ${fmt.pct(v)}`} className="num h-9 w-11 rounded text-[10px] font-medium text-white"
                    style={{ background: `rgba(16,185,129,${0.08 + alpha * 0.75})` }}>
                    {(v * 100).toFixed(1)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MarketTables({ p }: { p: PredictionResult }) {
  const { t, fmt } = useI18n();
  const dc = p.doubleChance;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Block title={t("match.goalsMarkets")}><OUTable rows={p.totals} caption={t("match.goalsMarkets")} /></Block>
      <div className="space-y-4">
        <Block title={t("match.btts")}>
          {(() => {
            const [y, n] = roundToHundred([p.btts.yes, p.btts.no], 1);
            return (
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="rounded-md bg-ink-800 p-3"><div className="text-xs text-mute">{t("common.yes")}</div><div className="num text-xl font-semibold text-emerald-400">{y.toFixed(1)}%</div><div className="num text-[11px] text-mute">@ {fmt.num(fairOdds(p.btts.yes))}</div></div>
                <div className="rounded-md bg-ink-800 p-3"><div className="text-xs text-mute">{t("common.no")}</div><div className="num text-xl font-semibold text-azure-400">{n.toFixed(1)}%</div><div className="num text-[11px] text-mute">@ {fmt.num(fairOdds(p.btts.no))}</div></div>
              </div>
            );
          })()}
        </Block>
        <Block title={t("match.doubleChance")}>
          <ul className="space-y-2 text-sm">
            {([["match.dc.1X", dc.homeOrDraw], ["match.dc.X2", dc.awayOrDraw], ["match.dc.12", dc.homeOrAway]] as const).map(([k, v]) => (
              <li key={k} className="flex items-center justify-between gap-2">
                <span className="text-slate-300">{t(k)}</span>
                <span><span className="num font-semibold text-slate-100">{fmt.pct(v)}</span> <span className="num text-[11px] text-mute">@ {fmt.num(fairOdds(v))}</span></span>
              </li>
            ))}
          </ul>
        </Block>
      </div>
      <Block title={t("match.correctScore")}><ScoreHeatmap p={p} /></Block>
      <Block title={t("match.firstHalf")}>
        <h4 className="mb-2 text-xs text-slate-300">{t("match.firstHalfResult")}</h4>
        <ProbBar {...p.firstHalf.oneXTwo} />
        <h4 className="mb-1 mt-4 text-xs text-slate-300">{t("match.firstHalfGoals")}</h4>
        <OUTable rows={p.firstHalf.totals} caption={t("match.firstHalfGoals")} />
        <p className="mt-2 text-[11px] text-mute">{t("match.htShare", { v: fmt.pct(p.firstHalf.shareOfGoals, 0) })} — {p.dataQuality.notes.includes("dq.htPrior") ? t("match.htSharePrior") : t("match.htShareObserved")}</p>
      </Block>
      <Block title={`${t("match.teamGoals")} — ${t("common.home")}`}><OUTable rows={p.homeGoals} caption={t("match.teamGoals")} /></Block>
      <Block title={`${t("match.teamGoals")} — ${t("common.away")}`}><OUTable rows={p.awayGoals} caption={t("match.teamGoals")} /></Block>
      <Block title={t("match.corners")}>
        {p.corners ? (<><OUTable rows={p.corners.lines} caption={t("match.corners")} /><p className="mt-2 text-[11px] text-mute">{t("match.countBased", { v: fmt.num(p.corners.expected, 1), n: p.corners.basedOnMatches })}</p></>) : <UnavailableNote u={{ reasonKey: "common.notSupplied" }} />}
      </Block>
      <Block title={t("match.cards")}>
        {p.cards ? (<><OUTable rows={p.cards.lines} caption={t("match.cards")} /><p className="mt-2 text-[11px] text-mute">{t("match.countBased", { v: fmt.num(p.cards.expected, 1), n: p.cards.basedOnMatches })}</p></>) : <UnavailableNote u={{ reasonKey: "common.notSupplied" }} />}
      </Block>
      <Block title={t("match.asian")} className="lg:col-span-2">
        {p.asianHandicap ? (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>{t("common.line")}</th><th>{t("match.ahHome")}</th><th>{t("match.ahPush")}</th><th>{t("match.ahAway")}</th></tr></thead>
              <tbody>
                {p.asianHandicap.map((r) => (
                  <tr key={r.line}>
                    <td className="num font-semibold text-slate-100" dir="ltr">{r.line > 0 ? `+${r.line}` : r.line}</td>
                    <td className="num text-emerald-400">{fmt.pct(r.homeWin)}</td>
                    <td className="num text-mute">{fmt.pct(r.push)}</td>
                    <td className="num text-azure-400">{fmt.pct(r.awayWin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <UnavailableNote u={{ reasonKey: "match.asianUnavailable" }} />}
      </Block>
    </div>
  );
}
