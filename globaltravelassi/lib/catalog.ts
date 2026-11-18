import type { ServiceRow } from "@/lib/domain";
import type { Locale } from "@/lib/i18n/config";
import { formatMoney, type Dict } from "@/lib/i18n";

export function serviceTitle(s: Pick<ServiceRow, "title_ar" | "title_fr" | "title_en">, locale: Locale): string {
  return locale === "ar" ? s.title_ar : locale === "fr" ? s.title_fr : s.title_en;
}

export function serviceDescription(s: Pick<ServiceRow, "description_ar" | "description_fr" | "description_en">, locale: Locale): string {
  return locale === "ar" ? s.description_ar : locale === "fr" ? s.description_fr : s.description_en;
}

export function servicePrice(s: Pick<ServiceRow, "price" | "currency">, dict: Dict, locale: Locale): string {
  if (s.price === null || s.price === undefined || s.price === "") return dict.common.priceOnRequest;
  return formatMoney(s.price, s.currency, locale);
}

/** Link to the request form, carrying the chosen service and the marketing source (utm_source). */
export function applyHref(locale: Locale, options: { service?: string; source?: string | null } = {}): string {
  const params = new URLSearchParams();
  if (options.service) params.set("service", options.service);
  if (options.source) params.set("utm_source", options.source.slice(0, 100));
  const query = params.toString();
  return `/${locale}/apply${query ? `?${query}` : ""}`;
}
