import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Regression: the middleware copied the request headers BEFORE the session refresh, so the page received the expired
 * token while the browser received the new one. The refreshed cookie must reach both.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/config", async (importOriginal) => ({ ...(await importOriginal<object>()), isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/middleware", () => ({
  refreshSession: async (request: NextRequest) => {
    if (!request.cookies.get("sb-test-auth-token")) return { user: null, cookies: [] };
    request.cookies.set("sb-test-auth-token", "fresh-token");
    return { user: { id: "u1" }, cookies: [{ name: "sb-test-auth-token", value: "fresh-token", options: { path: "/", httpOnly: true } }] };
  },
}));

const { middleware } = await import("@/middleware");

describe("session refresh in the middleware", () => {
  it("forwards the refreshed cookie to the page and sets it on the response", async () => {
    const res = await middleware(new NextRequest("http://localhost/en/dashboard", { headers: { cookie: "sb-test-auth-token=expired-token" } }));
    expect(res.status).toBe(200);
    const forwardedCookie = res.headers.get("x-middleware-request-cookie") ?? "";
    expect(forwardedCookie).toContain("sb-test-auth-token=fresh-token");
    expect(forwardedCookie).not.toContain("expired-token");
    expect(res.cookies.get("sb-test-auth-token")?.value).toBe("fresh-token");
    expect(res.headers.get("x-middleware-request-content-security-policy")).toContain("'nonce-");
  });

  it("still redirects a signed-out visitor away from a private page", async () => {
    const res = await middleware(new NextRequest("http://localhost/fr/dashboard"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/fr/auth/login?next=%2Ffr%2Fdashboard");
  });
});
