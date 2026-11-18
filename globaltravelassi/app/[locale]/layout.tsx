import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getDictionary, isLocale, type Locale } from "@/lib/i18n";
import { getCurrentUser } from "@/lib/auth";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { WhatsAppFloat } from "@/components/site/WhatsAppFloat";

// Rendered per request so prices, services and sign-in state are always current.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: raw } = await params;
  if (!isLocale(raw)) return {};
  const dict = getDictionary(raw);
  return {
    title: { default: dict.brand.name, template: `%s · ${dict.brand.name}` },
    description: dict.brand.tagline,
    alternates: {
      languages: { ar: "/ar", fr: "/fr", en: "/en" },
    },
    openGraph: { siteName: dict.brand.name, locale: raw === "ar" ? "ar_DZ" : raw === "fr" ? "fr_FR" : "en_GB" },
  };
}

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const user = await getCurrentUser();

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-gold-400 focus:px-4 focus:py-2 focus:text-navy-950">
        {locale === "ar" ? "تخطي إلى المحتوى" : locale === "fr" ? "Aller au contenu" : "Skip to content"}
      </a>
      <SiteHeader locale={locale} dict={dict} signedIn={Boolean(user)} />
      <main id="main" className="min-h-[70svh]">{children}</main>
      <SiteFooter locale={locale} dict={dict} />
      <WhatsAppFloat locale={locale} />
    </>
  );
}
