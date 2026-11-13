"use client";
import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { assessValue, impliedProbability, kellyFraction, KELLY_FRACTIONS, MAX_STAKE_FRACTION, overround, removeMarginPower, suggestedStake } from "@/lib/betting";
import { useI18n } from "./I18nProvider";

export const SETTINGS_KEY = "fap_settings";
export function readSettings(): { kelly: number; bankroll: number } {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    return { kelly: KELLY_FRACTIONS.includes(s.kelly) ? s.kelly : 0.25, bankroll: Number(s.bankroll) > 0 ? Number(s.bankroll) : 1000 };
  } catch {
    return { kelly: 0.25, bankroll: 1000 };
  }
}

export function ValueCalculator() {
  const { t, fmt } = useI18n();
  const [prob, setProb] = useState("55");
  const [odds, setOdds] = useState("2.00");
  const [market, setMarket] = useState("");
  const [idx, setIdx] = useState(0);
  const [unc, setUnc] = useState("0");
  const [fraction, setFraction] = useState<number>(0.25);
  const [bankroll, setBankroll] = useState("1000");
  useEffect(() => {
    const s = readSettings();
    setFraction(s.kelly);
    setBankroll(String(s.bankroll));
  }, []);

  const r = useMemo(() => {
    const p = Number(prob.replace(",", ".")) / 100;
    const o = Number(odds.replace(",", "."));
    if (!(p > 0 && p < 1 && o > 1 && o < 1000)) return null;
    const mk = market.split(/[,\s;]+/).filter(Boolean).map((x) => Number(x));
    const validMk = mk.length >= 2 && mk.every((x) => x > 1 && x < 1000);
    const fair = validMk ? removeMarginPower(mk) : null;
    const fairProb = fair ? fair[Math.min(idx, fair.length - 1)] : null;
    const b = Math.max(0, Number(bankroll) || 0);
    return {
      implied: impliedProbability(o),
      fair, fairProb, over: validMk ? overround(mk) : null, mk: validMk ? mk : null,
      a: assessValue(p, o, fairProb, 1, Math.min(50, Math.max(0, Number(unc.replace(",", ".")) || 0)) / 100),
      full: kellyFraction(p, o),
      stake: suggestedStake(b, p, o, fraction),
    };
  }, [prob, odds, market, idx, fraction, bankroll, unc]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label><span className="eyebrow mb-1 block">{t("value.modelProb")}</span><input className="input num" inputMode="decimal" value={prob} onChange={(e) => setProb(e.target.value)} dir="ltr" /></label>
          <label><span className="eyebrow mb-1 block">{t("value.decimalOdds")}</span><input className="input num" inputMode="decimal" value={odds} onChange={(e) => setOdds(e.target.value)} dir="ltr" /></label>
        </div>
        <label className="block">
          <span className="eyebrow mb-1 block">{t("value.uncertainty")}</span>
          <input className="input num" inputMode="decimal" value={unc} onChange={(e) => setUnc(e.target.value)} dir="ltr" />
          <span className="mt-1 block text-[11px] text-mute">{t("value.uncertaintyHint")}</span>
        </label>
        <label className="block">
          <span className="eyebrow mb-1 block">{t("value.marketOdds")}</span>
          <input className="input num" value={market} onChange={(e) => setMarket(e.target.value)} placeholder="2.10, 3.40, 3.60" dir="ltr" />
          <span className="mt-1 block text-[11px] text-mute">{t("value.marketOddsHint")}</span>
        </label>
        {r?.mk && (
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("value.selection")}>
            {r.mk.map((o, i) => (
              <button type="button" key={i} role="radio" aria-checked={idx === i} onClick={() => setIdx(i)} className={clsx("btn num px-2.5 py-1 text-xs", idx === i && "btn-primary")}>
                #{i + 1} @ {o.toFixed(2)} → {fmt.pct(r.fair![i])}
              </button>
            ))}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label><span className="eyebrow mb-1 block">{t("value.fraction")}</span>
            <select className="input" value={fraction} onChange={(e) => setFraction(Number(e.target.value))}>
              {KELLY_FRACTIONS.map((f) => <option key={f} value={f}>{f * 100}% Kelly</option>)}
            </select>
          </label>
          <label><span className="eyebrow mb-1 block">{t("value.bankroll")}</span><input className="input num" inputMode="decimal" value={bankroll} onChange={(e) => setBankroll(e.target.value)} dir="ltr" /></label>
        </div>
      </form>
      <div aria-live="polite">
        {!r ? <p className="text-sm text-rose-400">{t("value.invalid")}</p> : (
          <div className="space-y-3">
            <div className={clsx("rounded-xl border p-4", r.a.isValue ? "border-emerald-500/50 bg-emerald-500/5" : "border-line bg-ink-850")}>
              <div className="eyebrow">{t("value.evLabel")}</div>
              <div className={clsx("num mt-1 text-3xl font-bold", r.a.ev > 0 ? "text-emerald-400" : "text-rose-400")} dir="ltr">{fmt.signedPct(r.a.ev, 2)}</div>
              <div className="mt-1 text-xs text-slate-300">{t(r.a.reasonKey)}</div>
              <div className="num mt-1 text-[11px] text-mute">{t("value.consEv")}: <span dir="ltr">{fmt.signedPct(r.a.conservativeEv, 2)}</span></div>
              <div className="num mt-2 text-[11px] text-mute" dir="ltr">EV = {(Number(prob) / 100).toFixed(3)} × {Number(odds).toFixed(2)} − 1</div>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg bg-ink-800 p-3"><dt className="text-[11px] text-mute">{t("value.implied")}</dt><dd className="num mt-0.5 font-semibold">{fmt.pct(r.implied, 2)}</dd></div>
              <div className="rounded-lg bg-ink-800 p-3"><dt className="text-[11px] text-mute">{t("value.fairProb")}</dt><dd className="num mt-0.5 font-semibold">{fmt.pct(r.fairProb, 2)}</dd></div>
              <div className="rounded-lg bg-ink-800 p-3"><dt className="text-[11px] text-mute">{t("value.overround")}</dt><dd className="num mt-0.5 font-semibold">{fmt.pct(r.over, 2)}</dd></div>
              <div className="rounded-lg bg-ink-800 p-3"><dt className="text-[11px] text-mute">{t("match.edge")}</dt><dd className={clsx("num mt-0.5 font-semibold", r.a.edge > 0 ? "text-emerald-400" : "text-rose-400")} dir="ltr">{fmt.signedPct(r.a.edge, 2)}</dd></div>
              <div className="rounded-lg bg-ink-800 p-3"><dt className="text-[11px] text-mute">{t("value.fullKelly")}</dt><dd className="num mt-0.5 font-semibold">{fmt.pct(r.full, 2)}</dd></div>
              <div className="rounded-lg bg-ink-800 p-3"><dt className="text-[11px] text-mute">{t("value.stake")} ({fraction * 100}%)</dt><dd className="num mt-0.5 font-semibold text-gold-300">{fmt.num(r.stake)}</dd></div>
            </dl>
            <p className="text-[11px] text-mute">{t("value.stakeCap", { v: fmt.pct(MAX_STAKE_FRACTION, 0) })}</p>
            <p className="text-[11px] text-gold-300">{t("disclaimer.ev")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
