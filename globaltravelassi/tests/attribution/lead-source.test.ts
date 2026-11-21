import { describe, it, expect } from "vitest";
import { classifyLeadSource, decodeAttribution, encodeAttribution, refererHost } from "@/lib/attribution/lead-source";

const SITE = "globaltravelassi.online";

describe("campaign tags (utm_source)", () => {
  it("maps known tags to their channel, in any letter case", () => {
    expect(classifyLeadSource({ utmSource: "TikTok" })).toEqual({ source: "tiktok", detail: "tiktok" });
    expect(classifyLeadSource({ utmSource: "ig" })).toEqual({ source: "instagram", detail: "ig" });
    expect(classifyLeadSource({ utmSource: "fb" })).toEqual({ source: "facebook", detail: "fb" });
    expect(classifyLeadSource({ utmSource: "google_ads" })).toEqual({ source: "google", detail: "google_ads" });
    expect(classifyLeadSource({ utmSource: "wa" })).toEqual({ source: "whatsapp", detail: "wa" });
  });

  it("never guesses: an unknown tag is 'other', with the tag kept as a plain label", () => {
    expect(classifyLeadSource({ utmSource: "summer-flyer-2026" })).toEqual({ source: "other", detail: "summer-flyer-2026" });
  });

  it("drops a tag that is not a plain label (a URL or spaces), but still records the channel as other", () => {
    expect(classifyLeadSource({ utmSource: "https://evil.example/x" })).toEqual({ source: "other", detail: null });
    expect(classifyLeadSource({ utmSource: "my campaign" })).toEqual({ source: "other", detail: null });
  });

  it("wins over the referring site, because the owner set it on purpose", () => {
    expect(classifyLeadSource({ utmSource: "tiktok", referer: "https://www.google.com/" })).toEqual({ source: "tiktok", detail: "tiktok" });
  });
});

describe("referring site", () => {
  it.each([
    ["https://www.tiktok.com/@somebody", "tiktok"],
    ["https://m.instagram.com/p/abc", "instagram"],
    ["https://l.facebook.com/l.php?u=x", "facebook"],
    ["https://www.google.dz/search?q=visa", "google"],
    ["https://www.google.co.uk/", "google"],
    ["https://wa.me/213555000111", "whatsapp"],
    ["https://web.whatsapp.com/", "whatsapp"],
  ])("%s is %s", (referer, source) => {
    expect(classifyLeadSource({ referer, siteHost: SITE }).source).toBe(source);
  });

  it("an unknown site is 'other', never a guessed channel", () => {
    expect(classifyLeadSource({ referer: "https://blog.example.net/post", siteHost: SITE })).toEqual({ source: "other", detail: null });
  });

  it("a visit with no referrer and no tag is 'direct'", () => {
    expect(classifyLeadSource({ siteHost: SITE })).toEqual({ source: "direct", detail: null });
  });

  it("a visit from this site itself is 'direct', not a new channel", () => {
    expect(classifyLeadSource({ referer: `https://${SITE}/fr/services`, siteHost: SITE }).source).toBe("direct");
  });

  it("a malformed or non-web referrer is treated as no referrer", () => {
    expect(classifyLeadSource({ referer: "not a url", siteHost: SITE }).source).toBe("direct");
    expect(classifyLeadSource({ referer: "javascript:alert(1)", siteHost: SITE }).source).toBe("direct");
  });

  it("does not match a look-alike domain", () => {
    expect(classifyLeadSource({ referer: "https://nottiktok.com/", siteHost: SITE }).source).toBe("other");
    expect(classifyLeadSource({ referer: "https://tiktok.com.evil.example/", siteHost: SITE }).source).toBe("other");
  });
});

describe("cookie round trip", () => {
  it("encodes and decodes the same attribution", () => {
    const a = { source: "tiktok" as const, detail: "summer26" };
    expect(decodeAttribution(encodeAttribution(a))).toEqual(a);
    expect(decodeAttribution(encodeAttribution({ source: "direct", detail: null }))).toEqual({ source: "direct", detail: null });
  });

  it("a tampered cookie cannot choose a channel: an unknown value becomes 'other'", () => {
    expect(decodeAttribution("google_stolen")).toEqual({ source: "other", detail: null });
    expect(decodeAttribution("tiktok|<script>")).toEqual({ source: "tiktok", detail: null });
  });

  it("no cookie means no recorded attribution", () => {
    expect(decodeAttribution(undefined)).toBeNull();
    expect(decodeAttribution("")).toBeNull();
  });
});

describe("refererHost", () => {
  it("returns the lowercase host, or null", () => {
    expect(refererHost("https://WWW.TikTok.com/x")).toBe("www.tiktok.com");
    expect(refererHost(null)).toBeNull();
  });
});
