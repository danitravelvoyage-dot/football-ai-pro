import { describe, it, expect } from "vitest";
import { legal, fillLegal, LEGAL_UPDATED } from "@/lib/legal/content";
import { legalAt } from "@/lib/legal/meta";

const locales = ["ar", "fr", "en"] as const;
const everyText = (page: { title: string; intro: string; sections: { heading: string; paragraphs: string[] }[] }) =>
  [page.title, page.intro, ...page.sections.flatMap((s) => [s.heading, ...s.paragraphs])].join("\n");

describe("legal pages", () => {
  it("exist in Arabic, French and English with the same structure", () => {
    const shape = (l: (typeof locales)[number]) => ({
      privacy: legal[l].privacy.sections.length,
      terms: legal[l].terms.sections.length,
      cookies: legal[l].cookies.sections.length,
    });
    expect(shape("fr")).toEqual(shape("en"));
    expect(shape("ar")).toEqual(shape("en"));
    expect(LEGAL_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("the terms say the service guarantees no visa, appointment or booking, in every language", () => {
    expect(legal.en.terms.sections.map((s) => s.paragraphs.join(" ")).join(" ")).toMatch(/do not guarantee/i);
    expect(legal.fr.terms.sections.map((s) => s.paragraphs.join(" ")).join(" ")).toMatch(/ne garantissons/i);
    expect(legal.ar.terms.sections.map((s) => s.paragraphs.join(" ")).join(" ")).toMatch(/لا نضمن/);
  });

  it("make no success-rate, partnership or government-status claim", () => {
    for (const l of locales) {
      const text = [everyText(legal[l].privacy), everyText(legal[l].terms), everyText(legal[l].cookies)].join("\n");
      expect(text, l).not.toMatch(/\d+\s?%/);
      // Negated disclaimers ("we have no official partnership") are fine; affirmative claims are not.
      expect(text, l).not.toMatch(/we are (an? )?official|our official partners?|we are (the )?government|nous sommes (un )?partenaire officiel|nous sommes (le )?site officiel/i);
    }
  });

  it("fill the contact placeholders from configuration, and leave none behind when configured", () => {
    const filled = fillLegal("Contact: {contactEmail} · WhatsApp {whatsapp}", { email: "office@example.test", whatsapp: "213555000111" });
    expect(filled).toBe("Contact: office@example.test · WhatsApp +213555000111");
    expect(fillLegal("{contactEmail}", { email: "", whatsapp: "" })).toBe("—");
  });

  it("the cookie page describes the one attribution cookie by its real name", () => {
    for (const l of locales) expect(everyText(legal[l].cookies)).toContain("gta_lead_source");
  });

  it("the service disclaimer exists in every language", () => {
    for (const l of locales) expect(legalAt(l).disclaimer.length).toBeGreaterThan(40);
  });
});
