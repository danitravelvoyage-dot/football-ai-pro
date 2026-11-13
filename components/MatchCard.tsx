"use client";
import Link from "next/link";
import type { Match, OneXTwo } from "@/types";
import { useI18n } from "./I18nProvider";
import { Crest, ProbBar, StatusPill } from "./ui";

export function MatchCard({ match, probs }: { match: Match; probs?: OneXTwo | null }) {
  const { t, fmt } = useI18n();
  const { fullTime } = match.score;
  const showScore = fullTime.home !== null && fullTime.away !== null;
  return (
    <Link href={`/matches/${encodeURIComponent(match.id)}`}
      className="group panel block p-3.5 transition hover:border-emerald-500/40 hover:shadow-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
      <div className="mb-3 flex items-center justify-between gap-2 text-[11px] text-mute">
        <span className="truncate">{match.competition.name}{match.matchday ? ` · ${t("common.matchday")} ${match.matchday}` : ""}</span>
        <StatusPill status={match.status} />
      </div>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          {([[match.homeTeam, fullTime.home], [match.awayTeam, fullTime.away]] as const).map(([team, goals]) => (
            <div key={team.id} className="flex items-center gap-2">
              <Crest team={team} size={24} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-100" dir="auto">{team.name}</span>
              {showScore && <span className="num w-5 text-end text-sm font-semibold text-white">{goals}</span>}
            </div>
          ))}
        </div>
        {!showScore && (
          <div className="shrink-0 rounded-md bg-ink-800 px-2.5 py-1.5 text-center">
            <div className="num text-sm font-semibold text-white" dir="ltr">{fmt.time(match.utcDate)}</div>
            <div className="text-[10px] text-mute">{fmt.date(match.utcDate)}</div>
          </div>
        )}
      </div>
      {showScore && <div className="mt-1 text-[11px] text-mute">{fmt.date(match.utcDate)}</div>}
      {probs && <div className="mt-3"><ProbBar {...probs} compact /></div>}
    </Link>
  );
}
