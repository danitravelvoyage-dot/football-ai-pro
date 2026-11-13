import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { badRequest, serverError } from "@/lib/api";
import { addDaysYmd, isValidTimeZone, isYmd, ymdInTz } from "@/lib/dates";
import { LEAGUE_CODES } from "@/lib/competitions";
import { applyFilters, getMatchesBetween } from "@/services/matches";
import { quickPredictions } from "@/services/quick";

const Q = z.object({
  from: z.string().refine(isYmd, "YYYY-MM-DD").optional(),
  to: z.string().refine(isYmd, "YYYY-MM-DD").optional(),
  tz: z.string().max(64).refine(isValidTimeZone, "invalid timezone").optional(),
  league: z.enum(LEAGUE_CODES as [string, ...string[]]).optional(),
  country: z.string().max(40).optional(),
  q: z.string().max(60).optional(),
  status: z.enum(["live", "scheduled", "finished"]).optional(),
  predictions: z.enum(["0", "1"]).optional(),
});

/** GET /api/matches?from=YYYY-MM-DD&to=YYYY-MM-DD&tz=Europe/London&league=PL&predictions=1 */
export async function GET(req: NextRequest) {
  const parsed = Q.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return badRequest(parsed.error);
  const { tz = "UTC", from, to, predictions, ...filters } = parsed.data;
  const f = from ?? ymdInTz(new Date(), tz);
  const tt = to ?? f;
  if (tt < f || Date.parse(tt) - Date.parse(f) > 10 * 864e5) return badRequest("range must be 0–10 days");
  try {
    const feed = await getMatchesBetween(f, tt, tz);
    const matches = applyFilters(feed.matches, filters);
    const preds = predictions === "1" ? await quickPredictions(matches) : null;
    return NextResponse.json({
      from: f, to: addDaysYmd(tt, 0), source: feed.source, liveSupported: feed.liveSupported, error: feed.error ?? null,
      matches: matches.map((m) => ({ ...m, model: preds?.get(m.id) ? { modelVersion: preds.get(m.id)!.modelVersion, oneXTwo: preds.get(m.id)!.oneXTwo, lambdaHome: preds.get(m.id)!.lambdaHome, lambdaAway: preds.get(m.id)!.lambdaAway } : undefined })),
    });
  } catch (e) {
    return serverError(e);
  }
}
