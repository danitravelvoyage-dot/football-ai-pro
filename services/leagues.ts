import "server-only";
import { getFixturesProvider } from "@/services/providers";
import type { Match } from "@/types";
import { isUnavailable } from "@/types";

export interface LeagueSummary {
  played: number;
  goalsPerGame: number;
  homeWinRate: number;
  drawRate: number;
  awayWinRate: number;
  over25Rate: number;
  bttsRate: number;
  cleanSheetRate: number;
  goalDistribution: { goals: string; count: number }[];
  homeGoalsAvg: number;
  awayGoalsAvg: number;
}

export function summariseLeague(ms: Match[]): LeagueSummary | null {
  const f = ms.filter((m) => m.status === "FINISHED" && m.score.fullTime.home !== null);
  if (f.length === 0) return null;
  let goals = 0, hw = 0, d = 0, o25 = 0, bt = 0, cs = 0, hg = 0, ag = 0;
  const dist = new Array(7).fill(0);
  for (const m of f) {
    const h = m.score.fullTime.home!, a = m.score.fullTime.away!;
    goals += h + a; hg += h; ag += a;
    if (h > a) hw++;
    else if (h === a) d++;
    if (h + a > 2.5) o25++;
    if (h > 0 && a > 0) bt++;
    if (h === 0) cs++;
    if (a === 0) cs++;
    dist[Math.min(6, h + a)]++;
  }
  const n = f.length;
  return {
    played: n,
    goalsPerGame: goals / n,
    homeWinRate: hw / n,
    drawRate: d / n,
    awayWinRate: (n - hw - d) / n,
    over25Rate: o25 / n,
    bttsRate: bt / n,
    cleanSheetRate: cs / (2 * n),
    goalDistribution: dist.map((count, i) => ({ goals: i === 6 ? "6+" : String(i), count })),
    homeGoalsAvg: hg / n,
    awayGoalsAvg: ag / n,
  };
}

export async function getLeague(code: string) {
  const fx = getFixturesProvider();
  const [standings, matches] = await Promise.all([fx.getStandings(code), fx.getCompetitionMatches(code)]);
  return {
    standings,
    matches,
    summary: isUnavailable(matches) ? null : summariseLeague(matches.data),
  };
}
