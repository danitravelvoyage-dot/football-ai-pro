import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import { NextRequest } from "next/server";
import { buildCsp, generateNonce, supabaseOrigins } from "@/lib/security/csp";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/middleware", () => ({ refreshSession: async () => ({ user: null, cookies: [] }) }));

// Next.js's own parser for the nonce in the request's CSP header. Using it here means the test fails if Next would not
// find the nonce we put in the policy.
const nodeRequire = createRequire(import.meta.url);
const { getScriptNonceFromHeader } = nodeRequire("next/dist/server/app-render/get-script-nonce-from-header") as {
  getScriptNonceFromHeader: (value: string) => string | undefined;
};

const PROJECT = "https://abcdefgh.supabase.co";

function scriptSrc(policy: string): string {
  return policy.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src")) ?? "";
}

describe("generateNonce", () => {
  it("returns a base64 string that decodes to 16 random bytes", () => {
    const nonce = generateNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(atob(nonce).length).toBe(16);
  });

  it("changes on every call", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateNonce()));
    expect(seen.size).toBe(500);
  });
});

describe("buildCsp", () => {
  const nonce = "dGVzdC1ub25jZS0xMjM0NQ==";

  it("puts the nonce and strict-dynamic in script-src", () => {
    expect(scriptSrc(buildCsp(nonce, { projectUrl: PROJECT, development: false }))).toBe(
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    );
  });

  it("never allows unsafe-inline in script-src, in production or development", () => {
    expect(scriptSrc(buildCsp(nonce, { projectUrl: PROJECT, development: false }))).not.toContain("'unsafe-inline'");
    expect(scriptSrc(buildCsp(nonce, { projectUrl: PROJECT, development: true }))).not.toContain("'unsafe-inline'");
  });

  it("allows unsafe-eval in script-src only in development", () => {
    expect(scriptSrc(buildCsp(nonce, { projectUrl: PROJECT, development: false }))).not.toContain("'unsafe-eval'");
    expect(scriptSrc(buildCsp(nonce, { projectUrl: PROJECT, development: true }))).toContain("'unsafe-eval'");
  });

  it("is parsed by Next.js as carrying exactly this nonce", () => {
    expect(getScriptNonceFromHeader(buildCsp(nonce, { projectUrl: PROJECT, development: false }))).toBe(nonce);
  });

  it("is parsed by Next.js for a freshly generated nonce, including base64 characters", () => {
    for (let i = 0; i < 50; i++) {
      const fresh = generateNonce();
      expect(getScriptNonceFromHeader(buildCsp(fresh, { projectUrl: PROJECT, development: false }))).toBe(fresh);
    }
  });

  it("allows the exact Supabase origin for requests and websockets", () => {
    const policy = buildCsp(nonce, { projectUrl: PROJECT, development: false });
    expect(policy).toContain(`connect-src 'self' ${PROJECT} wss://abcdefgh.supabase.co`);
    expect(policy).toContain(`img-src 'self' data: blob: ${PROJECT}`);
  });

  it("falls back to the wildcard when no project URL is set", () => {
    const policy = buildCsp(nonce, { projectUrl: "", development: false });
    expect(policy).toContain("connect-src 'self' https://*.supabase.co wss://*.supabase.co");
  });

  it("keeps the protective directives", () => {
    const policy = buildCsp(nonce, { projectUrl: PROJECT, development: false });
    for (const directive of ["default-src 'self'", "object-src 'none'", "frame-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"]) {
      expect(policy).toContain(directive);
    }
  });

  it("keeps style-src as documented (unsafe-inline remains for React style props)", () => {
    expect(buildCsp(nonce, { projectUrl: PROJECT, development: false })).toContain("style-src 'self' 'unsafe-inline'");
  });
});

describe("supabaseOrigins", () => {
  it("derives the websocket origin from the project URL", () => {
    expect(supabaseOrigins(PROJECT)).toEqual({ http: PROJECT, ws: "wss://abcdefgh.supabase.co" });
  });

  it("uses the wildcard for an invalid URL", () => {
    expect(supabaseOrigins("not a url")).toEqual({ http: "https://*.supabase.co", ws: "wss://*.supabase.co" });
  });
});

describe("middleware: the nonce is per request and reaches Next.js and the browser", () => {
  async function run(path: string) {
    const { middleware } = await import("@/middleware");
    return middleware(new NextRequest(`http://localhost${path}`));
  }

  it("sends the policy on the response with a nonce in script-src", async () => {
    const res = await run("/en");
    const policy = res.headers.get("content-security-policy-report-only") ?? "";
    expect(policy).toBeTruthy();
    expect(getScriptNonceFromHeader(policy)).toBeTruthy();
    expect(scriptSrc(policy)).not.toContain("'unsafe-inline'");
  });

  it("forwards the same policy to Next.js on the request, so it can apply the nonce", async () => {
    const res = await run("/fr/services");
    const response = res.headers.get("content-security-policy-report-only");
    const forwarded = res.headers.get("x-middleware-request-content-security-policy");
    expect(forwarded).toBeTruthy();
    expect(forwarded).toBe(response);
  });

  it("gives every request a different nonce", async () => {
    const nonces = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const res = await run("/ar");
      nonces.add(getScriptNonceFromHeader(res.headers.get("content-security-policy-report-only") ?? "") ?? "");
    }
    expect(nonces.size).toBe(20);
  });

  it("applies the policy to locale redirects too, so no response is missing it", async () => {
    const res = await run("/services");
    expect(res.status).toBe(307);
    expect(res.headers.get("content-security-policy-report-only")).toContain("frame-ancestors 'none'");
  });

  it("ignores a Content-Security-Policy header sent by the client and replaces it", async () => {
    const { middleware } = await import("@/middleware");
    const req = new NextRequest("http://localhost/en", {
      headers: { "content-security-policy": "script-src 'self' 'unsafe-inline'" },
    });
    const res = await middleware(req);
    const forwarded = res.headers.get("x-middleware-request-content-security-policy") ?? "";
    expect(scriptSrc(forwarded)).not.toContain("'unsafe-inline'");
    expect(scriptSrc(forwarded)).toContain("'nonce-");
    expect(forwarded).not.toContain("script-src 'self' 'unsafe-inline'");
  });
});
