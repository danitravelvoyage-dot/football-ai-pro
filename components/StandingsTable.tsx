"use client";
import Link from "next/link";
import type { StandingRow } from "@/types";
import { useI18n } from "./I18nProvider";
import { Crest } from "./ui";

export function StandingsTable({ rows, highlight }: { rows: StandingRow[]; highlight?: string[] }) {
  const { t } = useI18n();
  const n = rows.length;
  return (
    <div className="overflow-x-auto">
      <table className="table-base">
        <caption className="sr-only">{t("leagues.standings")}</caption>
        <thead>
          <tr>
            <th>{t("common.position")}</th><th>{t("common.team")}</th><th className="text-center">{t("common.played")}</th>
            <th className="hidden text-center sm:table-cell">{t("common.won")}</th><th className="hidden text-center sm:table-cell">{t("common.drawn")}</th><th className="hidden text-center sm:table-cell">{t("common.lost")}</th>
            <th className="hidden text-center md:table-cell">{t("common.gf")}</th><th className="hidden text-center md:table-cell">{t("common.ga")}</th>
            <th className="text-center">{t("common.gd")}</th><th className="text-center">{t("common.points")}</th><th className="hidden lg:table-cell">{t("common.form")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.team.id} className={highlight?.includes(r.team.id) ? "bg-emerald-500/5" : undefined}>
              <td className="num">
                <span className={`inline-block w-6 border-s-2 ps-1.5 ${r.position <= 4 ? "border-emerald-500" : r.position > n - 3 && n >= 16 ? "border-rose-500" : "border-transparent"}`}>{r.position}</span>
              </td>
              <td><Link href={`/teams/${encodeURIComponent(r.team.id)}`} className="flex items-center gap-2 hover:text-emerald-300"><Crest team={r.team} size={20} /><span className="truncate">{r.team.shortName}</span></Link></td>
              <td className="num text-center">{r.played}</td>
              <td className="num hidden text-center sm:table-cell">{r.won}</td><td className="num hidden text-center sm:table-cell">{r.draw}</td><td className="num hidden text-center sm:table-cell">{r.lost}</td>
              <td className="num hidden text-center md:table-cell">{r.goalsFor}</td><td className="num hidden text-center md:table-cell">{r.goalsAgainst}</td>
              <td className="num text-center" dir="ltr">{r.goalDifference > 0 ? `+${r.goalDifference}` : r.goalDifference}</td>
              <td className="num text-center font-semibold text-white">{r.points}</td>
              <td className="hidden lg:table-cell">
                <span className="inline-flex gap-1" dir="ltr">
                  {(r.form ?? "").split(",").filter(Boolean).slice(0, 5).map((f, i) => (
                    <span key={i} className={`grid h-4 w-4 place-items-center rounded font-mono text-[9px] font-bold ${f === "W" ? "bg-emerald-500/20 text-emerald-300" : f === "D" ? "bg-slate-500/20 text-slate-300" : "bg-rose-500/20 text-rose-300"}`}>{f}</span>
                  ))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
