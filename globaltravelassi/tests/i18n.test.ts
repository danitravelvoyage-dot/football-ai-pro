import { describe, it, expect } from "vitest";
import { ar } from "@/lib/i18n/ar";
import { en } from "@/lib/i18n/en";
import { fr } from "@/lib/i18n/fr";
import { formatMoney, countryName, formatDate } from "@/lib/i18n";
import { locales, textDirection, isLocale } from "@/lib/i18n/config";
import { applicationStatuses, documentTypes, paymentMethods, paymentStatuses, employmentStatuses, serviceCategories } from "@/lib/domain";

/** Every key present in English must exist, non-empty, in Arabic and French (and nothing extra). */
function keyPaths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((item, i) => keyPaths(item, `${prefix}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => keyPaths(child, prefix ? `${prefix}.${key}` : key));
  }
  return [prefix];
}

describe("translations", () => {
  const reference = keyPaths(en).sort();

  it("Arabic has exactly the same keys as English", () => {
    expect(keyPaths(ar).sort()).toEqual(reference);
  });

  it("French has exactly the same keys as English", () => {
    expect(keyPaths(fr).sort()).toEqual(reference);
  });

  it("no translation is empty", () => {
    for (const dict of [en, fr, ar]) {
      const values = keyPaths(dict).map((path) => path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k.replace(/\[\d+\]/, "")], dict));
      expect(values.filter((v) => typeof v === "string" && v.trim() === "")).toHaveLength(0);
    }
  });

  it("every status, document type, payment option and category has a label in every language", () => {
    for (const dict of [en, fr, ar]) {
      expect(Object.keys(dict.statuses).sort()).toEqual([...applicationStatuses].sort());
      expect(Object.keys(dict.docTypes).sort()).toEqual([...documentTypes].sort());
      expect(Object.keys(dict.paymentMethods).sort()).toEqual([...paymentMethods].sort());
      expect(Object.keys(dict.paymentStatuses).sort()).toEqual([...paymentStatuses].sort());
      expect(Object.keys(dict.employment).sort()).toEqual([...employmentStatuses].sort());
      expect(Object.keys(dict.categories).sort()).toEqual([...serviceCategories].sort());
    }
  });
});

describe("locale helpers", () => {
  it("Arabic is right-to-left, French and English are left-to-right", () => {
    expect(textDirection("ar")).toBe("rtl");
    expect(textDirection("fr")).toBe("ltr");
    expect(textDirection("en")).toBe("ltr");
  });
  it("recognises only supported locales", () => {
    expect(locales).toEqual(["ar", "fr", "en"]);
    expect(isLocale("de")).toBe(false);
    expect(isLocale("fr")).toBe(true);
  });
  it("formats money in the visitor's language", () => {
    expect(formatMoney(15000, "DZD", "fr")).toContain("15");
    expect(formatMoney(null, "DZD", "fr")).toBe("—");
  });
  it("names countries in the visitor's language", () => {
    expect(countryName("DZ", "fr")).toBe("Algérie");
    expect(countryName("DZ", "en")).toBe("Algeria");
  });
  it("formats an ISO date without a timezone shift", () => {
    expect(formatDate("2030-03-05", "en")).toContain("2030");
    expect(formatDate(null, "en")).toBe("—");
  });
});
