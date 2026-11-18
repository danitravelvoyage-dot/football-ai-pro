import { whatsappLink } from "@/lib/config";
import { getDictionary, type Locale } from "@/lib/i18n";

const greeting: Record<Locale, string> = {
  ar: "مرحبًا، أريد الاستفسار عن خدمات التأشيرة والسفر.",
  fr: "Bonjour, je souhaite un renseignement sur vos services visa et voyage.",
  en: "Hello, I would like information about your visa and travel services.",
};

export function WhatsAppFloat({ locale }: { locale: Locale }) {
  const href = whatsappLink(greeting[locale]);
  if (!href) return null;
  const label = getDictionary(locale).nav.whatsapp;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="fixed bottom-5 end-5 z-40 inline-flex items-center gap-2 rounded-full bg-[#25D366] px-4 py-3 text-sm font-semibold text-white shadow-xl shadow-black/25 transition hover:-translate-y-0.5 hover:bg-[#1ebe5a]"
    >
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91A9.9 9.9 0 0 0 12.04 2zm5.8 14.13c-.25.7-1.45 1.34-2 1.4-.52.06-1.18.09-1.9-.12a17.5 17.5 0 0 1-1.72-.64c-3.03-1.31-5.01-4.37-5.16-4.57-.15-.2-1.23-1.64-1.23-3.13 0-1.49.78-2.22 1.06-2.52.27-.3.6-.37.8-.37h.58c.18 0 .43-.07.67.51.25.6.85 2.07.92 2.22.08.15.13.33.03.53-.1.2-.15.32-.3.5-.15.17-.31.39-.45.52-.15.15-.3.31-.13.6.17.3.76 1.25 1.64 2.03 1.13 1 2.08 1.31 2.38 1.46.3.15.47.13.65-.08.17-.2.75-.88.95-1.18.2-.3.4-.25.67-.15.27.1 1.73.82 2.03.97.3.15.5.22.57.35.08.12.08.72-.17 1.42z" /></svg>
      <span className="hidden sm:inline">{label}</span>
    </a>
  );
}
