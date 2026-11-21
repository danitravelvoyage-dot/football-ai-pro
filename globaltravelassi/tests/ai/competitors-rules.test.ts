import { describe, it, expect } from "vitest";
import { checkSourceUrl, detectChanges, extractOffers, isDue, opportunitiesFrom, parseDisplayedNumber, sourceInputSchema, visibleText, contentHash } from "@/lib/ai/competitors/rules";
import { robotsAllows } from "@/lib/ai/competitors/fetch";

describe("source URL policy", () => {
  it("accepts a public https page and normalises the host", () => {
    const r = checkSourceUrl("https://Example-Travel.dz/prices?lang=fr");
    expect(r).toEqual({ ok: true, url: "https://example-travel.dz/prices?lang=fr", host: "example-travel.dz" });
  });

  it.each([
    ["http://example.dz/prices", "not_https"],
    ["https://user:pass@example.dz/", "credentials_in_url"],
    ["https://example.dz:8443/", "non_default_port"],
    ["https://example.dz/#frag", "fragment_in_url"],
    ["https://localhost/", "not_public_name"],
    ["https://intranet.internal/", "not_public_name"],
    ["https://10.0.0.5/", "ip_literal"],
    ["https://[::1]/", "ip_literal"],
    ["not a url", "not_a_url"],
  ])("refuses %s (%s)", (url, reason) => {
    const r = checkSourceUrl(url);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(reason);
  });
});

describe("source input", () => {
  const base = { name: "Competitor pricing", url: "https://example.dz/prices", kind: "pricing_page", purpose: "Track visa package prices", termsReviewed: true, minIntervalHours: 24 };
  it("requires the terms to be reviewed", () => {
    expect(sourceInputSchema.safeParse({ ...base, termsReviewed: false }).success).toBe(false);
    expect(sourceInputSchema.safeParse(base).success).toBe(true);
  });
  it("keeps the interval within bounds", () => {
    expect(sourceInputSchema.safeParse({ ...base, minIntervalHours: 1 }).success).toBe(false);
    expect(sourceInputSchema.safeParse({ ...base, minIntervalHours: 24 }).success).toBe(true);
  });
});

describe("page text and prices", () => {
  it("removes scripts, styles and tags", () => {
    const html = "<html><script>var x=1</script><style>p{}</style><p>Visa <b>package</b>&nbsp;12 000 DZD</p></html>";
    expect(visibleText(html)).toBe("Visa package 12 000 DZD");
  });

  it("reads displayed numbers as displayed", () => {
    expect(parseDisplayedNumber("12 000")).toBe(12000);
    expect(parseDisplayedNumber("12,000")).toBe(12000);
    expect(parseDisplayedNumber("12.50")).toBe(12.5);
    expect(parseDisplayedNumber("12,50")).toBe(12.5);
    expect(parseDisplayedNumber("45")).toBe(45);
  });

  it("extracts prices written before or after the currency, in minor units", () => {
    const offers = extractOffers("Schengen package 120 000 DZD. Consultation € 45. Express $99.50 ");
    expect(offers.map((o) => `${o.currency}:${o.amountMinor}`)).toEqual(["DZD:12000000", "EUR:4500", "USD:9950"]);
  });

  it("does not read words that merely start with a currency code", () => {
    expect(extractOffers("Daily 12 DAILY tours")).toEqual([]);
  });

  it("drops duplicate and implausible amounts and caps the list", () => {
    const offers = extractOffers("100 EUR and 100 EUR again and 999999999 EUR");
    expect(offers).toHaveLength(1);
    expect(offers[0]?.amountMinor).toBe(10000);
  });
});

describe("change detection", () => {
  const o = (amountMinor: number, currency: "EUR" | "DZD" = "EUR") => ({ currency, amountMinor, context: "x" });

  it("reports nothing for a first observation", () => {
    expect(detectChanges(null, { contentHash: "a", offers: [o(100)] })).toEqual([]);
  });

  it("reports content and price changes with the lowest-price direction", () => {
    const changes = detectChanges({ contentHash: "a", offers: [o(100), o(200)] }, { contentHash: "b", offers: [o(120), o(200)] });
    const codes = changes.map((c) => c.code);
    expect(codes).toEqual(expect.arrayContaining(["content_changed", "price_added", "price_removed", "lowest_price_up"]));
    const up = changes.find((c) => c.code === "lowest_price_up");
    expect(up).toMatchObject({ currency: "EUR", from: 100, to: 120 });
  });

  it("reports no change when content and prices are identical", () => {
    expect(detectChanges({ contentHash: "a", offers: [o(100)] }, { contentHash: "a", offers: [o(100)] })).toEqual([]);
  });

  it("maps changes to owner-facing opportunities and threats", () => {
    const opps = opportunitiesFrom([
      { code: "lowest_price_up", currency: "EUR", from: 1, to: 2 },
      { code: "lowest_price_down", currency: "EUR", from: 2, to: 1 },
      { code: "price_removed", currency: "EUR", from: 5 },
      { code: "content_changed" },
    ]);
    expect(opps.map((x) => `${x.kind}:${x.code}`)).toEqual([
      "opportunity:competitor_price_increase",
      "threat:competitor_price_decrease",
      "opportunity:competitor_offer_removed",
    ]);
  });

  it("hashes text deterministically", () => {
    expect(contentHash("hello")).toBe(contentHash("hello"));
    expect(contentHash("hello")).not.toBe(contentHash("hello!"));
    expect(contentHash("hello")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("read interval", () => {
  it("is due when never read, and after the interval, but not before", () => {
    expect(isDue(null, "2026-11-21T10:00:00.000Z", 24)).toBe(true);
    expect(isDue("2026-11-21T00:00:00.000Z", "2026-11-21T23:00:00.000Z", 24)).toBe(false);
    expect(isDue("2026-11-21T00:00:00.000Z", "2026-11-22T00:00:00.000Z", 24)).toBe(true);
  });
});

describe("robots.txt", () => {
  it("allows everything when no rule applies or the rule is empty", () => {
    expect(robotsAllows("", "/prices")).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow:", "/prices")).toBe(true);
  });

  it("blocks a disallowed path for the generic agent", () => {
    expect(robotsAllows("User-agent: *\nDisallow: /private", "/private/page")).toBe(false);
    expect(robotsAllows("User-agent: *\nDisallow: /private", "/prices")).toBe(true);
  });

  it("lets a longer Allow rule override a shorter Disallow", () => {
    expect(robotsAllows("User-agent: *\nDisallow: /shop\nAllow: /shop/prices", "/shop/prices")).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow: /shop\nAllow: /shop/prices", "/shop/cart")).toBe(false);
  });

  it("prefers a rule group that names our agent", () => {
    const txt = "User-agent: *\nDisallow: /\n\nUser-agent: GlobalTravelAssi-Monitor\nAllow: /";
    expect(robotsAllows(txt, "/prices")).toBe(true);
  });

  it("ignores comments", () => {
    expect(robotsAllows("User-agent: * # everyone\nDisallow: /x # no", "/x/y")).toBe(false);
  });
});
