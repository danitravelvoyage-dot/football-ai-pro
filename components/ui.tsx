"use client";
import clsx from "clsx";
import { AlertTriangle, Database, Info } from "lucide-react";
import { roundToHundred } from "@/models/poisson";
import type { DataQuality, MatchStatus, SourceInfo, TeamRef, Unavailable } from "@/types";
import { useI18n } from "./I18nProvider";

export function Panel({ title, right, children, className, id }: { title?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={clsx("panel animate-fadein", className)} aria-label={typeof title === "string" ? title : undefined}>
      {(title || right) && (
        <div className="panel-head">
          {title && <h2 className="panel-title">{title}</h2>}
          {right}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Kpi({ label, value, hint, tone = "emerald" }: { label: string; value: React.ReactNode; hint?: string; tone?: "emerald" | "gold" | "azure" | "slate" }) {
  const c = { emerald: "text-emerald-400", gold: "text-gold-400", azure: "text-azure-400", slate: "text-slate-100" }[tone];
  return (
    <div className="panel p-4">
      <div className="eyebrow">{label}</div>
      <div className={clsx("num mt-2 text-2xl font-semibold", c)}>{value}</div>
      {hint && <div className="mt-1 text-xs text-mute">{hint}</div>}
    </div>
  );
}

export function SourceBadge({ source, className }: { source: SourceInfo; className?: string }) {
  const { t, fmt } = useI18n();
  return (
    <span className={clsx("inline-flex flex-wrap items-center gap-1.5 text-[11px] text-mute", className)}>
      <Database className="h-3 w-3" aria-hidden />
      <span>{t("source.label")}:</span>
      <span className="font-medium text-slate-300" dir="ltr">{source.provider}</span>
      {source.demo && <DemoBadge />}
      <span>· {t("source.fetched")}: <span className="num" dir="ltr">{fmt.dateTime(source.fetchedAt)}</span></span>
      <span>({source.cached ? t("source.cached") : t("source.live")})</span>
    </span>
  );
}

export function DemoBadge() {
  const { t } = useI18n();
  return <span className="rounded border border-gold-400/50 bg-gold-400/10 px-1.5 py-px text-[10px] font-bold tracking-wider text-gold-300">{t("demo.badge")}</span>;
}

export function UnavailableNote({ u, className }: { u: Unavailable | { reasonKey: string; provider?: string }; className?: string }) {
  const { t } = useI18n();
  return (
    <p className={clsx("flex items-start gap-2 rounded-lg border border-dashed border-line bg-ink-850/60 px-3 py-2 text-xs text-mute", className)}>
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        {t(u.reasonKey)}
        {u.provider && u.provider !== "none" && <span dir="ltr"> ({u.provider})</span>}
      </span>
    </p>
  );
}

export function Notice({ children, tone = "gold" }: { children: React.ReactNode; tone?: "gold" | "azure" }) {
  return (
    <div className={clsx("flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
      tone === "gold" ? "border-gold-400/40 bg-gold-400/5 text-gold-300" : "border-azure-500/40 bg-azure-500/5 text-azure-300")}>
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

function hue(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

export function Crest({ team, size = 28 }: { team: TeamRef; size?: number }) {
  if (team.crest)
    return <img src={team.crest} alt="" width={size} height={size} loading="lazy" className="shrink-0 object-contain" style={{ width: size, height: size }} />;
  const h = hue(team.name);
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full font-mono text-[10px] font-bold text-white ring-1 ring-white/10"
      style={{ width: size, height: size, background: `linear-gradient(135deg, hsl(${h} 55% 38%), hsl(${(h + 40) % 360} 60% 22%))`, fontSize: size * 0.32 }}
      dir="ltr"
    >
      {team.tla.slice(0, 3)}
    </span>
  );
}

export function StatusPill({ status }: { status: MatchStatus }) {
  const { t } = useI18n();
  const live = status === "IN_PLAY" || status === "PAUSED";
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
      live ? "bg-rose-500/15 text-rose-400" : status === "FINISHED" ? "bg-ink-700 text-slate-300" : ["POSTPONED", "CANCELLED", "SUSPENDED"].includes(status) ? "bg-gold-400/10 text-gold-300" : "bg-azure-500/10 text-azure-300")}>
      {live && <span className="h-1.5 w-1.5 animate-pulseDot rounded-full bg-rose-400" />}
      {t(`status.${status}`)}
    </span>
  );
}

export function FormPills({ form, size = "sm" }: { form: ("W" | "D" | "L")[]; size?: "sm" | "xs" }) {
  const { t } = useI18n();
  if (!form.length) return <span className="text-xs text-mute">—</span>;
  const label = (r: string) => (r === "W" ? t("common.won") : r === "D" ? t("common.drawn") : t("common.lost"));
  return (
    <span className="inline-flex gap-1" dir="ltr" aria-label={form.map(label).join(", ")}>
      {form.map((r, i) => (
        <span key={i} title={label(r)} className={clsx("grid place-items-center rounded font-mono font-bold",
          size === "sm" ? "h-5 w-5 text-[10px]" : "h-4 w-4 text-[9px]",
          r === "W" ? "bg-emerald-500/20 text-emerald-300" : r === "D" ? "bg-slate-500/20 text-slate-300" : "bg-rose-500/20 text-rose-300")}>
          {r}
        </span>
      ))}
    </span>
  );
}

/** Horizontal 1X2 bar. Displayed percentages always sum to exactly 100.0. */
export function ProbBar({ home, draw, away, compact }: { home: number; draw: number; away: number; compact?: boolean }) {
  const { t } = useI18n();
  const [h, d, a] = roundToHundred([home, draw, away], 1);
  return (
    <div>
      <div className={clsx("flex overflow-hidden rounded-md", compact ? "h-1.5" : "h-2.5")} role="img"
        aria-label={`${t("common.home")} ${h}%, ${t("common.draw")} ${d}%, ${t("common.away")} ${a}%`}>
        <div className="bg-emerald-500" style={{ width: `${h}%` }} />
        <div className="bg-slate-500" style={{ width: `${d}%` }} />
        <div className="bg-azure-500" style={{ width: `${a}%` }} />
      </div>
      {!compact && (
        <div className="mt-2 grid grid-cols-3 text-center text-xs">
          <div><div className="text-mute">{t("common.home")}</div><div className="num text-lg font-semibold text-emerald-400">{h.toFixed(1)}%</div></div>
          <div><div className="text-mute">{t("common.draw")}</div><div className="num text-lg font-semibold text-slate-200">{d.toFixed(1)}%</div></div>
          <div><div className="text-mute">{t("common.away")}</div><div className="num text-lg font-semibold text-azure-400">{a.toFixed(1)}%</div></div>
        </div>
      )}
      {compact && (
        <div className="num mt-1 flex justify-between text-[10px] text-mute">
          <span className="text-emerald-400">{h.toFixed(1)}</span>
          <span>{d.toFixed(1)}</span>
          <span className="text-azure-400">{a.toFixed(1)}</span>
        </div>
      )}
    </div>
  );
}

export function QualityBadge({ q }: { q: DataQuality }) {
  const { t, fmt } = useI18n();
  const c = q.level === "HIGH" ? "text-emerald-300 border-emerald-500/40" : q.level === "MEDIUM" ? "text-gold-300 border-gold-400/40" : "text-rose-400 border-rose-500/40";
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold", c)} title={q.notes.map((n) => t(n)).join(" ")}>
      {t("match.dataQuality")}: {t(`match.quality.${q.level}`)} <span className="num">({fmt.pct(q.score, 0)})</span>
    </span>
  );
}

export function PctCell({ p, strong }: { p: number; strong?: boolean }) {
  const { fmt } = useI18n();
  return (
    <span className={clsx("num", strong && "font-semibold text-slate-100")} dir="ltr">{fmt.pct(p)}</span>
  );
}

export function MiniBar({ value, tone = "emerald" }: { value: number; tone?: "emerald" | "azure" | "gold" }) {
  const c = { emerald: "bg-emerald-500", azure: "bg-azure-500", gold: "bg-gold-400" }[tone];
  return (
    <div className="h-1.5 w-full overflow-hidden rounded bg-ink-700" aria-hidden>
      <div className={clsx("h-full rounded", c)} style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-mute">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function T({ k, vars }: { k: string; vars?: Record<string, string | number> }) {
  const { t } = useI18n();
  return <>{t(k, vars)}</>;
}
