// Locale-agnostic i18n helpers usable from server and client components.
import { ar } from "./ar";
import { en, type Dict, type DictKey } from "./en";
import type { Locale } from "@/types";

export type { DictKey };
export const LOCALES: Locale[] = ["ar", "en"];
export const DEFAULT_LOCALE: Locale = "ar";
export const LOCALE_COOKIE = "fap_lang";
export const TZ_COOKIE = "fap_tz";
export const DEFAULT_TZ = "UTC";

const DICTS: Record<Locale, Dict> = { ar, en };

export function isLocale(x: unknown): x is Locale {
  return x === "ar" || x === "en";
}

export function dirOf(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

export type TFn = (key: DictKey | string, vars?: Record<string, string | number>) => string;

export function makeT(locale: Locale): TFn {
  const d = DICTS[locale];
  return (key, vars) => {
    let s: string = (d as Record<string, string>)[key] ?? (en as Record<string, string>)[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
  };
}

/** Formatting helpers. Latin digits are used in both languages for statistical readability. */
export function makeFmt(locale: Locale, tz: string) {
  const nfLocale = locale === "ar" ? "ar-u-nu-latn" : "en-GB";
  const dfLocale = locale === "ar" ? "ar-u-nu-latn" : "en-GB";
  // In Arabic, wrap numbers in Unicode LTR isolates so "41.8%" or "+3.2%" never get reordered inside RTL text.
  const iso = (x: string) => (locale === "ar" ? `\u2066${x}\u2069` : x);
  const safeTz = (() => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return tz;
    } catch {
      return "UTC";
    }
  })();
  return {
    tz: safeTz,
    pct: (p: number | null | undefined, digits = 1) =>
      p === null || p === undefined || Number.isNaN(p) ? "—" : iso(`${(p * 100).toFixed(digits)}%`),
    pctRaw: (v: number, digits = 1) => iso(`${v.toFixed(digits)}%`),
    num: (n: number | null | undefined, digits = 2) =>
      n === null || n === undefined || Number.isNaN(n) ? "—" : new Intl.NumberFormat(nfLocale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n),
    int: (n: number | null | undefined) => (n === null || n === undefined ? "—" : new Intl.NumberFormat(nfLocale).format(n)),
    signedPct: (p: number | null | undefined, digits = 1) =>
      p === null || p === undefined ? "—" : iso(`${p >= 0 ? "+" : "−"}${Math.abs(p * 100).toFixed(digits)}%`),
    time: (iso: string) => new Intl.DateTimeFormat(dfLocale, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: safeTz }).format(new Date(iso)),
    date: (iso: string) => new Intl.DateTimeFormat(dfLocale, { weekday: "short", day: "numeric", month: "short", timeZone: safeTz }).format(new Date(iso)),
    dateLong: (iso: string) => new Intl.DateTimeFormat(dfLocale, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: safeTz }).format(new Date(iso)),
    dateTime: (iso: string) =>
      new Intl.DateTimeFormat(dfLocale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: safeTz }).format(new Date(iso)),
  };
}
export type Fmt = ReturnType<typeof makeFmt>;
