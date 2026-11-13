import { NextResponse } from "next/server";
import { isValidCompetition } from "@/lib/competitions";
import { serverError } from "@/lib/api";
import { runBacktest } from "@/services/backtest";

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!isValidCompetition(code)) return NextResponse.json({ error: "Unknown competition", code: "INVALID_INPUT" }, { status: 400 });
  try {
    const r = await runBacktest(code.toUpperCase());
    return r ? NextResponse.json(r) : NextResponse.json({ error: "No data", code: "NOT_FOUND" }, { status: 404 });
  } catch (e) {
    return serverError(e);
  }
}
