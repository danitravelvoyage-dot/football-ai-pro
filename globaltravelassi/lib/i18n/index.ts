import { ar } from "./ar";
import { en, type Dict } from "./en";
import { fr } from "./fr";
import { intlLocale, type Locale } from "./config";

export * from "./config";
export type { Dict };

const dictionaries: Record<Locale, Dict> = { ar, fr, en };

export function getDictionary(locale: Locale): Dict {
  return dictionaries[locale];
}

export function formatDate(value: string | Date | null | undefined, locale: Locale): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value.length === 10 ? `${value}T00:00:00` : value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(intlLocale[locale], { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

export function formatDateTime(value: string | Date | null | undefined, locale: Locale): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(intlLocale[locale], {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

export function formatMoney(amount: number | string | null | undefined, currency: string, locale: Locale): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const value = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(intlLocale[locale], { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

/** Country name in the visitor's language, using the browser/Node ICU data. Falls back to the code. */
export function countryName(code: string, locale: Locale): string {
  try {
    return new Intl.DisplayNames([intlLocale[locale]], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
