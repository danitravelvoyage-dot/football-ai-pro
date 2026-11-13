"use client";
import { CheckCircle2, Lock } from "lucide-react";
import { useState } from "react";
import type { MarketKey } from "@/types";
import { useI18n } from "../I18nProvider";

const MARKETS: MarketKey[] = ["1X2_HOME", "1X2_DRAW", "1X2_AWAY", "OU25_OVER", "OU25_UNDER", "BTTS_YES", "BTTS_NO"];

export function TrackForm({ matchId, open, defaultMarket }: { matchId: string; open: boolean; defaultMarket: MarketKey }) {
  const { t } = useI18n();
  const [market, setMarket] = useState<MarketKey>(defaultMarket);
  const [odds, setOdds] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "busy" | "ok" | "err"; msg?: string }>({ kind: "idle" });
  if (!open) return <p className="flex items-center gap-2 text-xs text-mute"><Lock className="h-3.5 w-3.5" aria-hidden />{t("track.closed")}</p>;
  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_140px_auto] sm:items-end"
      onSubmit={async (e) => {
        e.preventDefault();
        const o = odds.trim() === "" ? null : Number(odds.replace(",", "."));
        if (o !== null && !(o > 1)) return setState({ kind: "err", msg: t("track.INVALID_ODDS") });
        setState({ kind: "busy" });
        try {
          const res = await fetch("/api/predictions", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ matchId, market, odds: o }),
          });
          const body = await res.json().catch(() => ({}));
          if (res.ok) setState({ kind: "ok", msg: t("track.ok") });
          else setState({ kind: "err", msg: t(`track.${body.code ?? "NOT_FOUND"}`) });
        } catch {
          setState({ kind: "err", msg: t("common.error") });
        }
      }}
    >
      <label>
        <span className="eyebrow mb-1 block">{t("track.market")}</span>
        <select className="input" value={market} onChange={(e) => setMarket(e.target.value as MarketKey)}>
          {MARKETS.map((m) => <option key={m} value={m}>{t(`mk.${m}`)}</option>)}
        </select>
      </label>
      <label>
        <span className="eyebrow mb-1 block">{t("track.odds")}</span>
        <input className="input num" inputMode="decimal" placeholder="1.95" value={odds} onChange={(e) => setOdds(e.target.value)} dir="ltr" />
      </label>
      <button className="btn btn-primary" disabled={state.kind === "busy" || state.kind === "ok"}>{t("track.submit")}</button>
      {state.msg && (
        <p role="status" className={`sm:col-span-3 flex items-center gap-2 text-xs ${state.kind === "ok" ? "text-emerald-400" : "text-rose-400"}`}>
          {state.kind === "ok" && <CheckCircle2 className="h-4 w-4" aria-hidden />}
          {state.msg}
        </p>
      )}
    </form>
  );
}
