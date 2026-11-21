import { describe, it, expect } from "vitest";
import { serviceContent, businessServiceSlugs, contentFor, serviceFallback } from "@/lib/services-content";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("service pages", () => {
  it("cover exactly the nine services of the business", () => {
    expect(businessServiceSlugs.sort()).toEqual([
      "appointment-assistance", "e-visa", "flight-booking", "france-visa-appointment", "hotel-booking",
      "transit-airport", "travel-itinerary", "visa-consulting", "visa-file-assistance",
    ].sort());
  });

  it("have a non-empty included list and a 'not promised' list in every language", () => {
    for (const slug of businessServiceSlugs) {
      for (const locale of ["ar", "fr", "en"] as const) {
        const c = contentFor(slug, locale);
        expect(c, `${slug}/${locale}`).not.toBeNull();
        expect(c!.includes.length, `${slug}/${locale} includes`).toBeGreaterThanOrEqual(2);
        expect(c!.notIncluded.length, `${slug}/${locale} notIncluded`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("never promise an outcome: no 'guaranteed approval' style wording in any language", () => {
    const text = JSON.stringify(serviceContent);
    expect(text).not.toMatch(/guaranteed visa approval|100\s?%|success rate|official partner/i);
  });

  it("the seed catalogue has every one of these slugs", () => {
    const seed = readFileSync(resolve(__dirname, "../../supabase/seed.sql"), "utf8") + readFileSync(resolve(__dirname, "../../supabase/seed_catalog.sql"), "utf8");
    for (const slug of businessServiceSlugs) expect(seed, slug).toContain(`'${slug}'`);
  });

  it("every service has a seed fallback title and description in every language", () => {
    for (const slug of businessServiceSlugs) {
      const fb = serviceFallback[slug];
      expect(fb, slug).toBeDefined();
      for (const l of ["ar", "fr", "en"] as const) {
        expect(fb!.title[l].length, `${slug} title ${l}`).toBeGreaterThan(3);
        expect(fb!.description[l].length, `${slug} description ${l}`).toBeGreaterThan(20);
      }
    }
    expect(serviceFallback["visa-consulting"]!.title.en).toBe("Visa consulting");
  });

  it("returns nothing for an unknown service or language", () => {
    expect(contentFor("cruise", "en")).toBeNull();
  });
});
