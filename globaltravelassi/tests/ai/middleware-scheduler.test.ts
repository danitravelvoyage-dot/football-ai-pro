import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

describe("middleware and the scheduler trigger path", () => {
  it("passes the exact scheduler trigger through without a locale redirect", async () => {
    const res = await middleware(new NextRequest("http://localhost/api/ai/scheduler", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("still redirects every other path without a locale", async () => {
    const res = await middleware(new NextRequest("http://localhost/api/ai/other"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(/\/(ar|fr|en)\/api\/ai\/other/);
  });

  it("does not exempt paths that only start with the trigger path", async () => {
    const res = await middleware(new NextRequest("http://localhost/api/ai/scheduler/extra"));
    expect(res.status).toBe(307);
  });
});
