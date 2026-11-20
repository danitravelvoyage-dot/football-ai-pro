import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { runSchedulerOnce } = vi.hoisted(() => ({ runSchedulerOnce: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/scheduler/worker", () => ({ runSchedulerOnce }));

import { POST, GET } from "@/app/api/ai/scheduler/route";

const SECRET = "x".repeat(40);
const REPORT = { disabled: false, enqueued: true, leased: 1, succeeded: 1, requeued: 0, deadLettered: 0, leaseLost: 0, cycles: { claimed: 0 } };

function call(auth?: string) {
  const headers = new Headers();
  if (auth !== undefined) headers.set("authorization", auth);
  return POST(new Request("http://localhost/api/ai/scheduler", { method: "POST", headers }));
}

let saved: string | undefined;

beforeEach(() => {
  saved = process.env.AI_SCHEDULER_SECRET;
  runSchedulerOnce.mockReset();
  runSchedulerOnce.mockResolvedValue({ ok: true, report: REPORT });
});

afterEach(() => {
  if (saved === undefined) delete process.env.AI_SCHEDULER_SECRET;
  else process.env.AI_SCHEDULER_SECRET = saved;
});

describe("scheduler trigger authentication", () => {
  it("refuses every call when no secret is configured: there is no default secret", async () => {
    delete process.env.AI_SCHEDULER_SECRET;
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, code: "not_configured" });
    expect(runSchedulerOnce).not.toHaveBeenCalled();
  });

  it("refuses a secret shorter than 32 characters", async () => {
    process.env.AI_SCHEDULER_SECRET = "short";
    const res = await call("Bearer short");
    expect(res.status).toBe(503);
    expect(runSchedulerOnce).not.toHaveBeenCalled();
  });

  it("refuses a missing header, a wrong token and another scheme", async () => {
    process.env.AI_SCHEDULER_SECRET = SECRET;
    expect((await call()).status).toBe(401);
    expect((await call("Bearer " + "y".repeat(40))).status).toBe(401);
    expect((await call(`Basic ${SECRET}`)).status).toBe(401);
    expect((await call("Bearer ")).status).toBe(401);
    expect(runSchedulerOnce).not.toHaveBeenCalled();
  });

  it("runs one pass with the correct bearer token and returns counts only", async () => {
    process.env.AI_SCHEDULER_SECRET = SECRET;
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ ok: true, report: REPORT });
    expect(body).not.toContain(SECRET);
    expect(runSchedulerOnce).toHaveBeenCalledTimes(1);
  });

  it("a worker that is not configured is reported as unavailable, with no detail", async () => {
    process.env.AI_SCHEDULER_SECRET = SECRET;
    runSchedulerOnce.mockResolvedValue({ ok: false, code: "not_configured" });
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, code: "not_configured" });
  });

  it("a failed run is a server error with a code, never the error text", async () => {
    process.env.AI_SCHEDULER_SECRET = SECRET;
    runSchedulerOnce.mockResolvedValue({ ok: false, code: "run_failed" });
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, code: "run_failed" });
  });

  it("GET is not allowed: the trigger accepts only POST", async () => {
    const res = await GET();
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });
});
