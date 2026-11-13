// Data-grounded match report. Every sentence is produced from a template filled ONLY with numbers
// retrieved from providers or computed by the model — no free-form text generation, no invented facts.
// Architecture note: an LLM summariser could later be plugged in, but it must receive exactly this
// structured evidence and must not be treated as a statistical prediction model.
import type { Fmt, TFn } from "@/lib/i18n";
import type { MatchAnalysis } from "@/services/analysis";
import { isUnavailable } from "@/types";

export interface ReportSection {
  id: string;
  title: string;
  bullets: string[];
}

export function generateReport(a: MatchAnalysis, t: TFn, fmt: Fmt): ReportSection[] {
  const m = a.match.data;
  const p = a.prediction;
  const H = m.homeTeam.shortName, A = m.awayTeam.shortName;
  const sh = a.stats.home, sa = a.stats.away;
  const rh = p.ratings.home, ra = p.ratings.away;
  const sections: ReportSection[] = [];

  // --- why home / away may win ---
  const sideCase = (side: "home" | "away"): string[] => {
    const isHome = side === "home";
    const team = isHome ? H : A, opp = isHome ? A : H;
    const r = isHome ? rh : ra, ro = isHome ? ra : rh;
    const s = isHome ? sh : sa;
    const out = [t("r.prob", { team, p: fmt.pct(isHome ? p.oneXTwo.home : p.oneXTwo.away) })];
    out.push(t("r.attack", { team, v: fmt.num(r.attack), opp, cmp: t(r.attack >= ro.attack ? "r.cmpStronger" : "r.cmpWeaker") }));
    out.push(t("r.defence", { team, v: fmt.num(r.defence) }));
    if (s.matches >= 3) out.push(t("r.form", { team, pts: s.formPoints5, form: s.last5.join("-") }));
    const venue = isHome ? s.home : s.away;
    if (venue.played > 0)
      out.push(t(isHome ? "r.homeRecord" : "r.awayRecord", { team, f: fmt.num(venue.avgFor), a: fmt.num(venue.avgAgainst), n: venue.played }));
    if (s.standing) out.push(t("r.position", { team, pos: s.standing.position, pts: s.standing.points }));
    if (isHome) out.push(t("r.homeAdv", { v: fmt.num(p.ratings.homeAdvantage) }));
    if (s.xgFor !== null) out.push(t("r.xg", { team, xg: fmt.num(s.xgFor), xga: fmt.num(s.xgAgainst) }));
    return out;
  };
  sections.push({ id: "home", title: t("report.home", { team: H }), bullets: sideCase("home") });
  sections.push({ id: "away", title: t("report.away", { team: A }), bullets: sideCase("away") });

  // --- draw ---
  const draw: string[] = [t("r.drawProb", { p: fmt.pct(p.oneXTwo.draw) })];
  const total = p.lambdaHome + p.lambdaAway;
  if (Math.abs(p.lambdaHome - p.lambdaAway) < 0.35) draw.push(t("r.closeRatings", { lh: fmt.num(p.lambdaHome), la: fmt.num(p.lambdaAway) }));
  if (total < 2.5) {
    const cs = (h: number, aw: number) => p.correctScores.find((s) => s.home === h && s.away === aw)?.p ?? 0;
    draw.push(t("r.lowScoring", { t: fmt.num(total), p00: fmt.pct(cs(0, 0)), p11: fmt.pct(cs(1, 1)) }));
  }
  if (a.h2hFinished.length >= 3) {
    const d = a.h2hFinished.filter((x) => x.score.fullTime.home === x.score.fullTime.away).length;
    if (d > 0) draw.push(t("r.h2hDraws", { d, n: a.h2hFinished.length }));
  }
  if (draw.length === 1 && Math.max(p.oneXTwo.home, p.oneXTwo.away) > 0.55) draw.push(t("r.noDrawFactors"));
  sections.push({ id: "draw", title: t("report.draw"), bullets: draw });

  // --- statistical advantages ---
  const adv: string[] = [];
  const cmp = (label: string, hv: number | null, av: number | null, higherBetter = true) => {
    if (hv === null || av === null || Math.abs(hv - av) < 1e-9) return;
    const homeBetter = higherBetter ? hv > av : hv < av;
    const [lead, other] = homeBetter ? [hv, av] : [av, hv];
    adv.push(t("r.adv", { team: homeBetter ? H : A, what: `${label} (${fmt.num(lead)} ${t("common.vs")} ${fmt.num(other)})` }));
  };
  cmp(t("match.attack"), rh.attack, ra.attack);
  cmp(t("match.defence"), rh.defence, ra.defence, false);
  if (sh.matches && sa.matches) {
    cmp(t("stat.avgScored"), sh.avgFor, sa.avgFor);
    cmp(t("stat.avgConceded"), sh.avgAgainst, sa.avgAgainst, false);
    cmp(t("stat.ppg"), sh.formPoints5 / Math.max(1, sh.last5.length), sa.formPoints5 / Math.max(1, sa.last5.length));
  }
  cmp(t("stat.xg"), sh.xgFor, sa.xgFor);
  cmp(t("stat.xga"), sh.xgAgainst, sa.xgAgainst, false);
  sections.push({ id: "adv", title: t("report.advantages"), bullets: adv.length ? adv : [t("common.noData")] });

  // --- missing players ---
  const missing: string[] = [];
  if (isUnavailable(a.availability)) missing.push(t("r.missingUnavailable"));
  else {
    const fmtList = (xs: typeof a.availability.data.home) =>
      xs.map((x) => `${x.player} (${t(`intel.type.${x.type}`)} — ${x.reason})`).join("; ");
    if (a.availability.data.home.length) missing.push(t("r.missingList", { team: H, list: fmtList(a.availability.data.home) }));
    if (a.availability.data.away.length) missing.push(t("r.missingList", { team: A, list: fmtList(a.availability.data.away) }));
    if (!missing.length) missing.push(t("r.noMissing"));
  }
  sections.push({ id: "missing", title: t("report.missing"), bullets: missing });

  // --- tactical ---
  const tac: string[] = [];
  for (const [team, s] of [[H, sh], [A, sa]] as const) {
    if (s.possession !== null && s.possession >= 54) tac.push(t("r.tacticPossession", { team, v: fmt.num(s.possession, 1) }));
    if (s.shots !== null) tac.push(t("r.tacticShots", { team, v: fmt.num(s.shots, 1), sot: fmt.num(s.shotsOnTarget, 1) }));
  }
  const ch = a.context.home, ca = a.context.away;
  if (ch.restDays !== null && ca.restDays !== null && Math.abs(ch.restDays - ca.restDays) >= 2) {
    const fresher = ch.restDays > ca.restDays;
    tac.push(t("r.tacticRest", { team: fresher ? H : A, d: fresher ? ch.restDays : ca.restDays, od: fresher ? ca.restDays : ch.restDays, opp: fresher ? A : H }));
  }
  for (const [team, c] of [[H, ch], [A, ca]] as const) if (c.matchesLast14 >= 4) tac.push(t("r.tacticCongestion", { team, n: c.matchesLast14 }));
  if (!tac.length) tac.push(t("r.tacticNone"));
  sections.push({ id: "tactical", title: t("report.tactical"), bullets: tac });

  // --- goals ---
  const o25 = p.totals.find((x) => x.line === 2.5)!;
  const top = p.correctScores[0];
  sections.push({
    id: "goals",
    title: t("report.goals"),
    bullets: [
      t("r.goalsExp", { lh: fmt.num(p.lambdaHome), la: fmt.num(p.lambdaAway), home: H, away: A, t: fmt.num(total) }),
      t("r.goalsOver", { p: fmt.pct(o25.over), b: fmt.pct(p.btts.yes) }),
      t("r.goalsTop", { s: `${top.home}-${top.away}`, p: fmt.pct(top.p) }),
    ],
  });

  // --- market ---
  const mk: string[] = [];
  const priced = a.market.filter((r) => r.assessment);
  if (!priced.length) mk.push(t("r.mktNone"));
  else {
    if (a.bookmakerMargin !== null) mk.push(t("r.mktMargin", { v: fmt.pct(a.bookmakerMargin) }));
    const notable = priced.filter((r) => Math.abs(r.assessment!.edge) >= 0.03);
    for (const r of notable)
      mk.push(t("r.mktCompare", {
        sel: t(`mk.${r.key}`), m: fmt.pct(r.modelProb), k: fmt.pct(r.fairMarketProb ?? r.assessment!.impliedProb),
        o: fmt.num(r.bestOdds), ev: fmt.signedPct(r.assessment!.ev),
      }));
    if (!notable.length) mk.push(t("r.mktAgree"));
  }
  sections.push({ id: "market", title: t("report.market"), bullets: mk });

  // --- uncertainty ---
  const fav = Math.max(p.oneXTwo.home, p.oneXTwo.away);
  const unc = [
    t("r.unc1", {
      lvl: t(`match.quality.${p.dataQuality.level}`),
      score: fmt.pct(p.dataQuality.score, 0),
      notes: p.dataQuality.notes.map((n) => t(n)).join(" "),
    }),
    t("r.unc2", { p: fmt.pct(fav, 0), q: fmt.pct(1 - fav, 0) }),
    t("r.unc3"),
  ];
  if (a.match.source.demo) unc.push(t("r.unc4"));
  sections.push({ id: "uncertainty", title: t("report.uncertainty"), bullets: unc });

  return sections;
}
