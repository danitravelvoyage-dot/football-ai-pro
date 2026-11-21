import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { legal } from "@/lib/legal/content";
import { siteConfig } from "@/lib/config";
import { LegalPage } from "@/components/site/LegalPage";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = (isLocale(raw) ? raw : "ar") as Locale;
  return {
    title: legal[locale].cookies.title,
    description: legal[locale].cookies.intro,
    alternates: { languages: Object.fromEntries(["ar", "fr", "en"].map((l) => [l, `${siteConfig.siteUrl}/${l}/cookies`])) },
  };
}

export default async function CookiesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  return <LegalPage page={legal[raw as Locale].cookies} locale={raw as Locale} />;
}
