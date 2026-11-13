import "server-only";
import { cookies } from "next/headers";
import { isValidTimeZone } from "@/lib/dates";
import type { Locale } from "@/types";
import { DEFAULT_LOCALE, DEFAULT_TZ, isLocale, LOCALE_COOKIE, makeFmt, makeT, TZ_COOKIE } from "./index";

export async function getLocale(): Promise<Locale> {
  const c = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(c) ? c : DEFAULT_LOCALE;
}

export async function getTz(): Promise<string> {
  const c = (await cookies()).get(TZ_COOKIE)?.value;
  return c && isValidTimeZone(c) ? c : DEFAULT_TZ;
}

export async function getI18n() {
  const [locale, tz] = await Promise.all([getLocale(), getTz()]);
  return { locale, tz, t: makeT(locale), fmt: makeFmt(locale, tz) };
}
