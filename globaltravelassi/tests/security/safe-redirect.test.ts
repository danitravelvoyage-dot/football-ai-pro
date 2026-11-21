import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { sameOriginPath } from "@/lib/security/redirect";

vi.mock("server-only", () => ({}));

const auth = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({ auth }),
}));

const FALLBACK = "/en/dashboard";

/** Every candidate here must end on the fallback: none of them is a same-origin path. */
const REJECTED: [string, string][] = [
  ["protocol-relative", "//evil.example/x"],
  ["protocol-relative with triple slash", "///evil.example"],
  ["backslash after slash", "/\\evil.example/x"],
  ["double backslash", "\\\\evil.example"],
  ["backslash only", "\\evil.example"],
  ["tab after slash (URL parser strips it)", "/\t/evil.example"],
  ["tab inside protocol-relative", "/\t/\tevil.example"],
  ["newline after slash", "/\n/evil.example"],
  ["carriage return after slash", "/\r/evil.example"],
  ["leading space", " //evil.example"],
  ["leading tab", "\t//evil.example"],
  ["NUL byte", "/\u0000/evil.example"],
  ["DEL character", "/\u007F/evil.example"],
  ["absolute https URL", "https://evil.example/x"],
  ["absolute http URL", "http://evil.example/x"],
  ["javascript scheme", "javascript:alert(1)"],
  ["data scheme", "data:text/html,hi"],
  ["bare host", "evil.example"],
  ["empty", ""],
  ["whitespace only", "   "],
];

const ACCEPTED: [string, string, string][] = [
  ["plain locale path", "/en/dashboard", "/en/dashboard"],
  ["path with query", "/fr/dashboard?tab=payments", "/fr/dashboard?tab=payments"],
  ["path with hash", "/ar/apply#step-2", "/ar/apply#step-2"],
  ["root", "/", "/"],
  ["percent-encoded space stays a path", "/en/a%20b", "/en/a%20b"],
];

describe("sameOriginPath: rejected destinations fall back", () => {
  for (const [label, candidate] of REJECTED) {
    it(`rejects ${label}`, () => {
      expect(sameOriginPath(candidate, FALLBACK)).toBe(FALLBACK);
    });
  }

  it("rejects null and undefined", () => {
    expect(sameOriginPath(null, FALLBACK)).toBe(FALLBACK);
    expect(sameOriginPath(undefined, FALLBACK)).toBe(FALLBACK);
  });

  it("rejects a candidate that resolves to another origin even with a custom base", () => {
    expect(sameOriginPath("/x", FALLBACK, "https://site.example")).toBe("/x");
    expect(sameOriginPath("//evil.example/x", FALLBACK, "https://site.example")).toBe(FALLBACK);
  });
});

describe("sameOriginPath: plain paths pass through unchanged", () => {
  for (const [label, candidate, expected] of ACCEPTED) {
    it(`accepts ${label}`, () => {
      expect(sameOriginPath(candidate, FALLBACK)).toBe(expected);
    });
  }

  it("resolves against the supplied base origin", () => {
    expect(sameOriginPath("/en/dashboard", FALLBACK, "https://site.example")).toBe("/en/dashboard");
  });
});

describe("safeNext (server actions) uses the same rules", () => {
  let safeNext: typeof import("@/lib/actions/helpers").safeNext;

  beforeEach(async () => {
    ({ safeNext } = await import("@/lib/actions/helpers"));
  });

  for (const [label, candidate] of REJECTED) {
    it(`rejects ${label}`, () => {
      expect(safeNext(candidate, "en")).toBe("/en/dashboard");
    });
  }

  it("keeps a valid path", () => {
    expect(safeNext("/fr/dashboard?x=1", "fr")).toBe("/fr/dashboard?x=1");
  });

  it("uses the supplied fallback", () => {
    expect(safeNext("//evil.example", "ar", "/ar/admin")).toBe("/ar/admin");
  });
});

describe("auth callback route: the Location header is never off-site", () => {
  beforeEach(() => {
    auth.exchangeCodeForSession.mockReset().mockResolvedValue({ error: null });
    auth.verifyOtp.mockReset().mockResolvedValue({ error: null });
  });

  async function callback(query: string, locale = "en") {
    const { GET } = await import("@/app/[locale]/auth/callback/route");
    const request = new NextRequest(`https://site.example/${locale}/auth/callback?${query}`);
    const response = await GET(request, { params: Promise.resolve({ locale }) });
    return response.headers.get("location") ?? "";
  }

  const hostOf = (location: string) => new URL(location).host;

  const bypasses = [
    "//evil.example/x",
    "/\\evil.example/x",
    "/\t/evil.example",
    "/\n/evil.example",
    "https://evil.example/x",
    "%5C%5Cevil.example",
  ];

  for (const next of bypasses) {
    it(`does not redirect off-site for next=${JSON.stringify(next)}`, async () => {
      const location = await callback(`code=abc&next=${encodeURIComponent(next)}`);
      expect(hostOf(location)).toBe("site.example");
      expect(location).toBe("https://site.example/en/dashboard");
    });
  }

  it("keeps a same-origin next after a successful exchange", async () => {
    const location = await callback(`code=abc&next=${encodeURIComponent("/en/admin/payments?page=2")}`);
    expect(location).toBe("https://site.example/en/admin/payments?page=2");
  });

  it("sends an expired link to sign-in regardless of next", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ error: { message: "expired" } });
    const location = await callback(`code=abc&next=${encodeURIComponent("//evil.example")}`, "fr");
    expect(location).toBe("https://site.example/fr/auth/login?error=expired");
  });

  it("falls back to the locale dashboard when next is missing", async () => {
    const location = await callback("token_hash=h&type=recovery", "ar");
    expect(location).toBe("https://site.example/ar/dashboard");
  });
});
