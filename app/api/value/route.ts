import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { badRequest } from "@/lib/api";
import { assessValue, impliedProbability, kellyFraction, KELLY_FRACTIONS, MAX_STAKE_FRACTION, overround, removeMarginPower, removeMarginProportional, suggestedStake } from "@/lib/betting";

const Body = z.object({
  modelProb: z.number().gt(0).lt(1),
  odds: z.number().gt(1).lt(1000),
  marketOdds: z.array(z.number().gt(1).lt(1000)).min(2).max(20).optional(),
  selectionIndex: z.number().int().min(0).max(19).optional(),
  dataQuality: z.number().min(0).max(1).default(1),
  bankroll: z.number().min(0).max(1e9).default(0),
  uncertainty: z.number().min(0).max(0.5).default(0),
});

/** POST /api/value — EV / margin removal / Kelly calculator. */
export async function POST(req: NextRequest) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return badRequest("invalid JSON");
  }
  const p = Body.safeParse(json);
  if (!p.success) return badRequest(p.error);
  const { modelProb, odds, marketOdds, selectionIndex = 0, dataQuality, bankroll, uncertainty } = p.data;
  const fair = marketOdds ? { power: removeMarginPower(marketOdds), proportional: removeMarginProportional(marketOdds), overround: overround(marketOdds) } : null;
  const fairProb = fair ? fair.power[Math.min(selectionIndex, marketOdds!.length - 1)] : null;
  return NextResponse.json({
    impliedProb: impliedProbability(odds),
    fair,
    assessment: assessValue(modelProb, odds, fairProb, dataQuality, uncertainty),
    kelly: { full: kellyFraction(modelProb, odds), cap: MAX_STAKE_FRACTION, stakes: KELLY_FRACTIONS.map((f) => ({ fraction: f, stake: suggestedStake(bankroll, modelProb, odds, f) })) },
    disclaimer: "Positive EV is model-dependent and does not guarantee profit.",
  });
}
