"use client";
import { createContext, useContext, useMemo } from "react";
import { makeFmt, makeT, type Fmt, type TFn } from "@/lib/i18n";
import type { Locale } from "@/types";

interface Ctx {
  locale: Locale;
  tz: string;
  t: TFn;
  fmt: Fmt;
}
const I18nCtx = createContext<Ctx | null>(null);

export function I18nProvider({ locale, tz, children }: { locale: Locale; tz: string; children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, tz, t: makeT(locale), fmt: makeFmt(locale, tz) }), [locale, tz]);
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export function useI18n(): Ctx {
  const c = useContext(I18nCtx);
  if (!c) throw new Error("useI18n must be used inside I18nProvider");
  return c;
}
