// DEMO dataset generator. Everything produced here is SIMULATED and is always labelled "DEMO"
// in the UI. Fixtures use real club names for realism, but all results, statistics, injuries and
// odds are generated from a seeded random model — they are NOT real-world data.
// The demo never simulates live play: matches before today are finished, today/future are scheduled.
import { COMPETITIONS } from "@/lib/competitions";
import type { BookmakerOdds, Competition, Match, PlayerAvailability, TeamRef } from "@/types";

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function poissonSample(rng: () => number, lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0,
    p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L && k < 20);
  return k - 1;
}

const CLUBS: Record<string, { names: string[]; top: string[]; current: number }> = {
  PL: {
    names: ["Arsenal", "Aston Villa", "Bournemouth", "Brentford", "Brighton & Hove Albion", "Burnley", "Chelsea", "Crystal Palace", "Everton", "Fulham", "Leeds United", "Liverpool", "Manchester City", "Manchester United", "Newcastle United", "Nottingham Forest", "Sunderland", "Tottenham Hotspur", "West Ham United", "Wolverhampton Wanderers"],
    top: ["Arsenal", "Liverpool", "Manchester City", "Chelsea", "Newcastle United", "Aston Villa"],
    current: 12,
  },
  PD: {
    names: ["Alavés", "Athletic Club", "Atlético Madrid", "Barcelona", "Celta Vigo", "Elche", "Espanyol", "Getafe", "Girona", "Levante", "Mallorca", "Osasuna", "Rayo Vallecano", "Real Betis", "Real Madrid", "Real Oviedo", "Real Sociedad", "Sevilla", "Valencia", "Villarreal"],
    top: ["Real Madrid", "Barcelona", "Atlético Madrid", "Villarreal", "Athletic Club"],
    current: 12,
  },
  SA: {
    names: ["Atalanta", "Bologna", "Cagliari", "Como", "Cremonese", "Fiorentina", "Genoa", "Hellas Verona", "Inter", "Juventus", "Lazio", "Lecce", "AC Milan", "Napoli", "Parma", "Pisa", "Roma", "Sassuolo", "Torino", "Udinese"],
    top: ["Inter", "Napoli", "Juventus", "AC Milan", "Atalanta", "Roma"],
    current: 11,
  },
  BL1: {
    names: ["Augsburg", "Bayer Leverkusen", "Bayern München", "Borussia Dortmund", "Borussia Mönchengladbach", "Eintracht Frankfurt", "1. FC Köln", "SC Freiburg", "Hamburger SV", "Heidenheim", "Hoffenheim", "Mainz 05", "RB Leipzig", "St. Pauli", "Union Berlin", "VfB Stuttgart", "Werder Bremen", "VfL Wolfsburg"],
    top: ["Bayern München", "Borussia Dortmund", "Bayer Leverkusen", "RB Leipzig", "VfB Stuttgart"],
    current: 10,
  },
  FL1: {
    names: ["Angers", "Auxerre", "Brest", "Le Havre", "Lens", "Lille", "Lorient", "Lyon", "Marseille", "Metz", "Monaco", "Nantes", "Nice", "Paris FC", "Paris Saint-Germain", "Rennes", "Strasbourg", "Toulouse"],
    top: ["Paris Saint-Germain", "Marseille", "Monaco", "Lille", "Lyon"],
    current: 11,
  },
};

interface DemoTeam extends TeamRef {
  league: string;
  strength: number; // latent quality, ~N(0,1)
  att: number;
  def: number;
}

export interface DemoDataset {
  dayKey: string;
  generatedAt: string;
  teams: Map<string, DemoTeam>;
  matches: Match[];
  trueLambdas: Map<string, { lh: number; la: number }>;
}

const BASE = 1.32;
const HOME_ADV = 1.18;

function tla(name: string) {
  const words = name.replace(/[^A-Za-zÀ-ÿ0-9 ]/g, "").split(" ").filter((w) => w.length > 1 && !/^(FC|AC|SC|VfL|VfB|RB|de)$/.test(w));
  return (words.length >= 2 ? words[0][0] + words[1].slice(0, 2) : (words[0] ?? name).slice(0, 3)).toUpperCase();
}

function comp(code: string): Competition {
  const c = COMPETITIONS.find((x) => x.code === code)!;
  return { code: c.code, name: c.name, country: c.country, countryCode: c.countryCode, type: c.type };
}

function utcDay(offsetDays: number, hour: number, minute: number, today: Date): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offsetDays, hour, minute));
  return d.toISOString();
}

/** Circle-method round robin: returns rounds of [homeIdx, awayIdx]. Double round robin. */
function roundRobin(n: number): [number, number][][] {
  const idx = Array.from({ length: n }, (_, i) => i);
  const rounds: [number, number][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [number, number][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = idx[i],
        b = idx[n - 1 - i];
      pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    idx.splice(1, 0, idx.pop()!);
  }
  return [...rounds, ...rounds.map((p) => p.map(([a, b]) => [b, a] as [number, number]))];
}

function simulate(
  rng: () => number,
  home: DemoTeam,
  away: DemoTeam,
  id: string,
  competition: Competition,
  utcDate: string,
  finished: boolean,
  matchday: number,
  set: DemoDataset,
  neutral = false,
): Match {
  const lh = BASE * (neutral ? 1 : HOME_ADV) * home.att * away.def;
  const la = BASE * away.att * home.def;
  set.trueLambdas.set(id, { lh, la });
  const base: Match = {
    id,
    competition,
    utcDate,
    status: finished ? "FINISHED" : "TIMED", // demo kick-off times are fixed
    matchday,
    stage: competition.type === "LEAGUE" ? "REGULAR_SEASON" : "LEAGUE_STAGE",
    homeTeam: strip(home),
    awayTeam: strip(away),
    score: { fullTime: { home: null, away: null }, halfTime: { home: null, away: null } },
    venue: null,
  };
  if (!finished) return base;
  const gh = poissonSample(rng, lh);
  const ga = poissonSample(rng, la);
  const split = (g: number) => {
    let h = 0;
    for (let i = 0; i < g; i++) if (rng() < 0.44) h++;
    return h;
  };
  const xgH = Math.max(0.05, 0.55 * lh + 0.35 * gh + (rng() - 0.5) * 0.6);
  const xgA = Math.max(0.05, 0.55 * la + 0.35 * ga + (rng() - 0.5) * 0.6);
  const shotsH = Math.max(2, Math.round(xgH * 7 + 4 + rng() * 4));
  const shotsA = Math.max(2, Math.round(xgA * 7 + 4 + rng() * 4));
  const possH = Math.round(Math.min(72, Math.max(28, 50 + (home.strength - away.strength) * 7 + (rng() - 0.5) * 10)));
  return {
    ...base,
    score: { fullTime: { home: gh, away: ga }, halfTime: { home: split(gh), away: split(ga) } },
    stats: {
      xg: { home: round2(xgH), away: round2(xgA) },
      shots: { home: shotsH, away: shotsA },
      shotsOnTarget: { home: Math.round(shotsH * (0.28 + rng() * 0.15)), away: Math.round(shotsA * (0.28 + rng() * 0.15)) },
      possession: { home: possH, away: 100 - possH },
      corners: { home: poissonSample(rng, 4.2 * Math.sqrt(lh / BASE)), away: poissonSample(rng, 4.0 * Math.sqrt(la / BASE)) },
      cards: { home: poissonSample(rng, 1.9), away: poissonSample(rng, 2.1) },
    },
  };
}
const round2 = (x: number) => Math.round(x * 100) / 100;
function strip(t: DemoTeam): TeamRef {
  return { id: t.id, name: t.name, shortName: t.shortName, tla: t.tla };
}

let memo: DemoDataset | null = null;

export function getDemoDataset(now = new Date()): DemoDataset {
  const dayKey = now.toISOString().slice(0, 10);
  if (memo && memo.dayKey === dayKey) return memo;
  resolved.clear();
  const today = new Date(dayKey + "T00:00:00Z");
  const set: DemoDataset = { dayKey, generatedAt: new Date().toISOString(), teams: new Map(), matches: [], trueLambdas: new Map() };

  // ---- teams ----
  for (const [code, info] of Object.entries(CLUBS)) {
    const r = mulberry32(hashStr("teams-" + code));
    info.names.forEach((name, i) => {
      const topIdx = info.top.indexOf(name);
      const strength = topIdx >= 0 ? 1.6 - topIdx * 0.22 + (r() - 0.5) * 0.3 : -0.9 + r() * 1.3;
      const id = `${code.toLowerCase()}-${i + 1}`;
      set.teams.set(id, {
        id, name, shortName: name.replace(/ (United|Hotspur|Wanderers|& Hove Albion)$/, ""), tla: tla(name), league: code, strength,
        att: Math.exp(0.24 * strength + (r() - 0.5) * 0.12),
        def: Math.exp(-0.2 * strength + (r() - 0.5) * 0.12),
      });
    });
  }

  // ---- domestic leagues ----
  for (const [code, info] of Object.entries(CLUBS)) {
    const teams = [...set.teams.values()].filter((t) => t.league === code);
    const rounds = roundRobin(teams.length);
    const rng = mulberry32(hashStr(`results-${code}-${dayKey.slice(0, 7)}`));
    const c = comp(code);
    rounds.slice(0, info.current + 3).forEach((pairs, r) => {
      pairs.forEach(([hi, ai], k) => {
        const id = `d-${code}-${r + 1}-${k + 1}`;
        let date: string;
        let finished: boolean;
        if (r < info.current) {
          const daysAgo = 7 * (info.current - r);
          date = utcDay(-daysAgo + (k % 2), 14 + (k % 4) * 2, k % 3 === 0 ? 30 : 0, today);
          finished = true;
        } else {
          // current round split between today and tomorrow; later rounds weekly
          const offset = r === info.current ? (k < pairs.length / 2 ? 0 : 1) : 7 * (r - info.current) + (k % 2);
          const times: [number, number][] = [[12, 30], [15, 0], [17, 30], [19, 45], [20, 0]];
          const [h, m] = times[k % times.length];
          date = utcDay(offset, h, m, today);
          finished = false;
        }
        set.matches.push(simulate(rng, teams[hi], teams[ai], id, c, date, finished, r + 1, set));
      });
    });
  }

  // ---- European competitions (league phase, simulated pairings) ----
  const ranked = [...set.teams.values()].sort((a, b) => b.strength - a.strength);
  const euro: [string, DemoTeam[], number][] = [
    ["CL", ranked.slice(0, 36), 2],
    ["EL", ranked.slice(36, 72), 3],
  ];
  for (const [code, pool, weekday] of euro) {
    const rng = mulberry32(hashStr(`euro-${code}-${dayKey.slice(0, 7)}`));
    const c = comp(code);
    for (let md = 1; md <= 6; md++) {
      const order = [...pool].sort(() => rng() - 0.5);
      // played matchdays every 14 days in the past; MD5 & MD6 upcoming
      const offset = md <= 4 ? -(14 * (4 - md) + 4 + weekday) : 3 + weekday + 14 * (md - 5);
      for (let k = 0; k < order.length / 2; k++) {
        const id = `d-${code}-${md}-${k + 1}`;
        const date = utcDay(offset, k % 2 ? 20 : 17, k % 2 ? 0 : 45, today);
        set.matches.push(simulate(rng, order[2 * k], order[2 * k + 1], id, c, date, md <= 4, md, set));
      }
    }
  }

  set.matches.sort((a, b) => a.utcDate.localeCompare(b.utcDate));
  memo = set;
  return set;
}

const resolved = new Map<string, Match>();

/**
 * A DEMO fixture whose kickoff was more than 2 hours ago gets a deterministic simulated full-time
 * result (seeded by match id). Matches are never shown as in-play: DEMO does not simulate live play.
 */
export function resolveDemoMatch(m: Match, set: DemoDataset, now = Date.now()): Match {
  if (m.status !== "TIMED" || now < new Date(m.utcDate).getTime() + 2 * 3600_000) return m;
  const hit = resolved.get(m.id);
  if (hit) return hit;
  const h = set.teams.get(m.homeTeam.id), a = set.teams.get(m.awayTeam.id);
  if (!h || !a) return m;
  const rng = mulberry32(hashStr("resolve-" + m.id));
  const tmp: DemoDataset = { ...set, trueLambdas: new Map() };
  const out = simulate(rng, h, a, m.id, m.competition, m.utcDate, true, m.matchday ?? 0, tmp);
  resolved.set(m.id, out);
  return out;
}

/** Synthetic DEMO head-to-head history (previous seasons) for a pair of teams. */
export function demoHeadToHead(homeId: string, awayId: string, set: DemoDataset): Match[] {
  const h = set.teams.get(homeId),
    a = set.teams.get(awayId);
  if (!h || !a) return [];
  const key = [homeId, awayId].sort().join("|");
  const rng = mulberry32(hashStr("h2h-" + key));
  const n = 3 + Math.floor(rng() * 4);
  const out: Match[] = [];
  const tmp: DemoDataset = { ...set, trueLambdas: new Map() };
  const today = new Date(set.dayKey + "T00:00:00Z");
  const currentMatches = set.matches.filter(
    (m) => m.status === "FINISHED" && [m.homeTeam.id, m.awayTeam.id].includes(homeId) && [m.homeTeam.id, m.awayTeam.id].includes(awayId),
  );
  for (let i = 0; i < n; i++) {
    const swap = i % 2 === 1;
    const date = utcDay(-(200 + i * 180 + Math.floor(rng() * 30)), 19, 0, today);
    out.push(
      simulate(rng, swap ? a : h, swap ? h : a, `d-h2h-${key}-${i}`, comp(h.league === a.league ? h.league : "CL"), date, true, 0, tmp),
    );
  }
  return [...currentMatches, ...out].sort((x, y) => y.utcDate.localeCompare(x.utcDate));
}

/** DEMO injuries/suspensions with anonymised player labels. */
export function demoAvailability(teamId: string, dayKey: string): PlayerAvailability[] {
  const rng = mulberry32(hashStr(`inj-${teamId}-${dayKey}`));
  const n = Math.floor(rng() * 4);
  const pos = ["Goalkeeper", "Defender", "Midfielder", "Forward"];
  const reasons: [PlayerAvailability["type"], string][] = [
    ["INJURY", "Hamstring"], ["INJURY", "Knee"], ["INJURY", "Ankle"], ["SUSPENSION", "Yellow card accumulation"], ["DOUBTFUL", "Illness"], ["SUSPENSION", "Red card"],
  ];
  return Array.from({ length: n }, (): PlayerAvailability => {
    const [type, reason] = reasons[Math.floor(rng() * reasons.length)];
    return {
      player: `DEMO Player #${2 + Math.floor(rng() * 28)}`,
      position: pos[Math.floor(rng() * 4)],
      type,
      reason,
      expectedReturn: type === "SUSPENSION" ? null : `${1 + Math.floor(rng() * 6)} weeks`,
    };
  });
}

/** DEMO bookmaker odds: true simulator probabilities + noise + ~5.5% margin. */
export function demoOdds(match: Match, set: DemoDataset): BookmakerOdds[] {
  const l = set.trueLambdas.get(match.id);
  if (!l) return [];
  const rng = mulberry32(hashStr("odds-" + match.id));
  const pmf = (k: number, lam: number) => {
    let f = 1;
    for (let i = 2; i <= k; i++) f *= i;
    return (Math.pow(lam, k) * Math.exp(-lam)) / f;
  };
  let ph = 0, pd = 0, pa = 0, under = 0;
  for (let i = 0; i <= 10; i++)
    for (let j = 0; j <= 10; j++) {
      const p = pmf(i, l.lh) * pmf(j, l.la);
      if (i > j) ph += p;
      else if (i === j) pd += p;
      else pa += p;
      if (i + j < 2.5) under += p;
    }
  const books = ["DEMO Book A", "DEMO Book B"];
  return books.map((bookmaker, b) => {
    const noisy = [ph, pd, pa].map((p) => Math.max(0.03, p * (1 + (rng() - 0.5) * 0.06)));
    const s = noisy.reduce((x, y) => x + y, 0);
    const margin = 1.05 + b * 0.015;
    const odds = noisy.map((p) => Math.max(1.01, Math.round((1 / ((p / s) * margin)) * 100) / 100));
    const pu = Math.min(0.9, Math.max(0.1, under * (1 + (rng() - 0.5) * 0.05)));
    return {
      bookmaker,
      lastUpdate: set.generatedAt,
      markets: [
        { key: "h2h", outcomes: [{ label: "HOME", price: odds[0] }, { label: "DRAW", price: odds[1] }, { label: "AWAY", price: odds[2] }] },
        {
          key: "totals",
          outcomes: [
            { label: "OVER", point: 2.5, price: Math.round((1 / ((1 - pu) * margin)) * 100) / 100 },
            { label: "UNDER", point: 2.5, price: Math.round((1 / (pu * margin)) * 100) / 100 },
          ],
        },
      ],
    };
  });
}
