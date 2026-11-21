import { NextResponse } from "next/server";
import { runWatchdogOnce } from "@/lib/ai/scheduler/worker";
import { authorizeTrigger } from "@/lib/ai/scheduler/auth";

/**
 * Independent watchdog. It checks whether the scheduler has run recently and writes a critical notice to the
 * owner's inbox when it has not. It does not run scheduled work and does not depend on the scheduler.
 * Call it from a second external trigger, on its own schedule, with the same bearer secret.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const auth = authorizeTrigger(request.headers.get("authorization"), process.env.AI_SCHEDULER_SECRET);
  if (!auth.ok) return NextResponse.json({ ok: false, code: auth.code }, { status: auth.status, headers: NO_STORE });

  const outcome = await runWatchdogOnce();
  if (!outcome.ok) {
    const status = outcome.code === "run_failed" ? 500 : 503;
    return NextResponse.json({ ok: false, code: outcome.code }, { status, headers: NO_STORE });
  }
  return NextResponse.json({ ok: true, schedulerStatus: outcome.schedulerStatus, notified: outcome.notified }, { status: 200, headers: NO_STORE });
}

export async function GET() {
  return NextResponse.json({ ok: false, code: "method_not_allowed" }, { status: 405, headers: { ...NO_STORE, Allow: "POST" } });
}
