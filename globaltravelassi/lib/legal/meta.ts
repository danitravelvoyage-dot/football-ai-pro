import type { Locale } from "@/lib/i18n/config";

/** Short notices used on several pages. Wording is kept with the legal pages; the owner reviews it before launch. */
const notices: Record<Locale, { disclaimer: string }> = {
  ar: { disclaimer: "القرارات الرسمية تصدرها الجهات المختصة. لا نضمن الحصول على تأشيرة أو موعد أو حجز. التفاصيل في شروط الاستخدام." },
  fr: { disclaimer: "Les décisions officielles sont prises par les autorités compétentes. Nous ne garantissons ni visa, ni rendez-vous, ni réservation. Détails dans les conditions d’utilisation." },
  en: { disclaimer: "Official decisions are made by the competent authorities. We do not guarantee a visa, an appointment or a booking. Details are in the terms of use." },
};

export function legalAt(locale: Locale) {
  return notices[locale];
}
