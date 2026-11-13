import { NextResponse } from "next/server";
import { serverError } from "@/lib/api";
import { analyseMatch } from "@/services/analysis";

/** GET /api/matches/:id — full analysis (model, markets, stats, context) with source metadata. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) return NextResponse.json({ error: "Invalid id", code: "INVALID_INPUT" }, { status: 400 });
  try {
    const a = await analyseMatch(id);
    if (!a) return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
    // omit the large league match list from the API payload
    const { leagueMatches: _lm, homeRecent: _hr, awayRecent: _ar, ...rest } = a;
    void _lm; void _hr; void _ar;
    return NextResponse.json(rest);
  } catch (e) {
    return serverError(e);
  }
}
