"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { locales, localeNames, type Locale } from "@/lib/i18n/config";

/** Links to the same page in another language and remembers the choice in a cookie. */
export function LanguageSwitcher({ current, label }: { current: Locale; label: string }) {
  const pathname = usePathname() ?? `/${current}`;
  const rest = pathname.replace(/^\/(ar|fr|en)(?=\/|$)/, "");
  return (
    <nav aria-label={label} className="flex items-center gap-1 rounded-full border border-white/15 p-1 text-xs font-semibold">
      {locales.map((locale) => {
        const active = locale === current;
        return (
          <Link
            key={locale}
            href={`/${locale}${rest}`}
            hrefLang={locale}
            aria-current={active ? "page" : undefined}
            onClick={() => {
              document.cookie = `NEXT_LOCALE=${locale}; path=/; max-age=31536000; samesite=lax`;
            }}
            className={`rounded-full px-3 py-1.5 transition ${active ? "bg-gold-400 text-navy-950" : "text-white/80 hover:text-white"}`}
          >
            {locale === "ar" ? "AR" : locale === "fr" ? "FR" : "EN"}
            <span className="sr-only">{localeNames[locale]}</span>
          </Link>
        );
      })}
    </nav>
  );
}
