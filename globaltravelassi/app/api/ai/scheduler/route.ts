import { NextResponse } from "next/server";
import { runSchedulerOnce } from "@/lib/ai/scheduler/worker";
import { authorizeTrigger } from "@/lib/ai/scheduler/auth";

/**
 * Trigger for the autonomous scheduler. An external scheduler (for example a cron service) calls this
 * endpoint on an interval with `Authorization: Bearer <AI_SCHEDULER_SECRET>`.
 *
 * Nothing in this repository calls it on a timer. Until the owner configures a real external trigger,
 * the scheduler runs only when this endpoint is called.
 *
 * Responses carry counts and status codes only. They never include credentials, prompts, outputs or personal data.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const auth = authorizeTrigger(request.headers.get("authorization"), process.env.AI_SCHEDULER_SECRET);
  if (!auth.ok) return NextResponse.json({ ok: false, code: auth.code }, { status: auth.status, headers: NO_STORE });

  const outcome = await runSchedulerOnce();
  if (!outcome.ok) {
    const status = outcome.code === "run_failed" ? 500 : 503;
    return NextResponse.json({ ok: false, code: outcome.code }, { status, headers: NO_STORE });
  }
  return NextResponse.json({ ok: true, report: outcome.report }, { status: 200, headers: NO_STORE });
}

export async function GET() {
  return NextResponse.json({ ok: false, code: "method_not_allowed" }, { status: 405, headers: { ...NO_STORE, Allow: "POST" } });
}
