import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { badRequest, serverError } from "@/lib/api";
import { listPredictions, MARKETS, recordPrediction } from "@/services/predictions";

const Body = z.object({
  matchId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
  market: z.enum(MARKETS as [string, ...string[]]),
  odds: z.number().gt(1).lt(1000).nullable().optional(),
});

/** GET /api/predictions — history + summary metrics (also settles finished matches). */
export async function GET() {
  try {
    return NextResponse.json(await listPredictions());
  } catch (e) {
    return serverError(e);
  }
}

/** POST /api/predictions { matchId, market, odds? } — probabilities are computed server-side. */
export async function POST(req: NextRequest) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return badRequest("invalid JSON");
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return badRequest(parsed.error);
  try {
    const r = await recordPrediction(parsed.data.matchId, parsed.data.market as (typeof MARKETS)[number], parsed.data.odds ?? null);
    if (r.ok) return NextResponse.json(r.prediction, { status: 201 });
    const status = r.code === "NOT_FOUND" ? 404 : r.code === "DUPLICATE" ? 409 : r.code === "INVALID_ODDS" ? 400 : 422;
    return NextResponse.json({ error: r.code, code: r.code }, { status });
  } catch (e) {
    return serverError(e);
  }
}
