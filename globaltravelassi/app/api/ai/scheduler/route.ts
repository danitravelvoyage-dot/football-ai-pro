import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runSchedulerOnce } from "@/lib/ai/scheduler/worker";

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

const MIN_SECRET_LENGTH = 32;
const NO_STORE = { "Cache-Control": "no-store" };

/** Compares digests, so the comparison takes the same time whatever the presented value is. */
function matches(presented: string, expected: string): boolean {
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const expected = process.env.AI_SCHEDULER_SECRET ?? "";
  // Without a configured secret of adequate length the endpoint refuses every call. There is no default secret.
  if (expected.length < MIN_SECRET_LENGTH) {
    return NextResponse.json({ ok: false, code: "not_configured" }, { status: 503, headers: NO_STORE });
  }

  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!presented || !matches(presented, expected)) {
    return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

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
