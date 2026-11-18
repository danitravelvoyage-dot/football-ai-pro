export const locales = ["ar", "fr", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "ar";

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

export function textDirection(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

/** Name of the language as written in that language, for the language switcher. */
export const localeNames: Record<Locale, string> = {
  ar: "العربية",
  fr: "Français",
  en: "English",
};

/** Intl locale tags used for dates and country names. */
export const intlLocale: Record<Locale, string> = {
  ar: "ar-DZ",
  fr: "fr-FR",
  en: "en-GB",
};
