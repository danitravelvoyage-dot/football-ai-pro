import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, type Locale } from "@/lib/i18n";
import { findServiceBySlug } from "@/lib/queries";
import { applyHref, serviceDescription, servicePrice, serviceTitle } from "@/lib/catalog";
import { siteConfig, whatsappLink } from "@/lib/config";
import { contentFor, businessServiceSlugs, serviceFallback } from "@/lib/services-content";
import type { ServiceRow } from "@/lib/domain";
import { Badge, ButtonLink, Card, Container, Section } from "@/components/ui";
import { legalAt } from "@/lib/legal/meta";

export const dynamic = "force-dynamic";

/** The page's data: the database row when it exists and is active, otherwise the seed copy. Hidden services are not shown. */
async function resolveService(slug: string): Promise<{ service: ServiceRow } | null> {
  const lookup = await findServiceBySlug(slug);
  if (lookup.state === "inactive") return null;
  if (lookup.state === "active") return { service: lookup.row };
  const fb = serviceFallback[slug];
  if (!fb) return null;
  return {
    service: {
      id: "",
      slug,
      category: fb.category as ServiceRow["category"],
      title_ar: fb.title.ar,
      title_fr: fb.title.fr,
      title_en: fb.title.en,
      description_ar: fb.description.ar,
      description_fr: fb.description.fr,
      description_en: fb.description.en,
      price: null,
      currency: "DZD",
      is_active: true,
      sort_order: 0,
    },
  };
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 0)) || cut}…`;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Metadata> {
  const { locale: raw, slug } = await params;
  if (!isLocale(raw) || !businessServiceSlugs.includes(slug)) return {};
  const locale = raw as Locale;
  const resolved = await resolveService(slug);
  if (!resolved) return {};
  const { service } = resolved;
  const dict = getDictionary(locale);
  const title = serviceTitle(service, locale);
  const description = clip(serviceDescription(service, locale), 155);
  const path = `/${locale}/services/${slug}`;
  const languages = Object.fromEntries(["ar", "fr", "en"].map((l) => [l, `${siteConfig.siteUrl}/${l}/services/${slug}`]));
  return {
    title,
    description,
    alternates: { canonical: `${siteConfig.siteUrl}${path}`, languages },
    openGraph: {
      title: `${title} · ${dict.brand.name}`,
      description,
      url: `${siteConfig.siteUrl}${path}`,
      siteName: dict.brand.name,
      locale: locale === "ar" ? "ar_DZ" : locale === "fr" ? "fr_FR" : "en_GB",
      type: "website",
    },
  };
}

export default async function ServiceDetailPage({ params, searchParams }: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ utm_source?: string }>;
}) {
  const { locale: raw, slug } = await params;
  if (!isLocale(raw) || !businessServiceSlugs.includes(slug)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const resolved = await resolveService(slug);
  if (!resolved) notFound();
  const { service } = resolved;
  const copy = contentFor(slug, locale);
  if (!copy) notFound();
  const { utm_source: source } = await searchParams;
  const title = serviceTitle(service, locale);
  const wa = whatsappLink(`${dict.services.waPrefix} ${title}`);
  const price = servicePrice(service, dict, locale);
  const hasPrice = service.price !== null && service.price !== "";

  return (
    <Section className="pt-12 sm:pt-16">
      <Container className="max-w-4xl">
        <Link href={`/${locale}/services`} className="text-sm font-semibold text-navy-600 hover:text-gold-600">← {dict.services.backToServices}</Link>

        <header className="mt-6 space-y-5">
          <Badge tone="gold">{dict.categories[service.category]}</Badge>
          <h1 className="font-display text-4xl font-semibold leading-tight text-navy-900 sm:text-5xl">{title}</h1>
          <p className="text-lg leading-relaxed text-navy-700">{serviceDescription(service, locale)}</p>
          <p className={hasPrice ? "text-xl font-semibold text-navy-900" : "text-base text-navy-600"}>
            {hasPrice && <span className="me-2 text-sm font-normal text-navy-500">{dict.services.priceFrom}</span>}
            {price}
          </p>
        </header>

        <div className="mt-10 flex flex-col gap-4 sm:flex-row">
          <ButtonLink href={applyHref(locale, { service: slug, source })} variant="gold">{dict.services.requestCta}</ButtonLink>
          {wa && <ButtonLink href={wa} external variant="whatsapp">{dict.services.whatsappCta}</ButtonLink>}
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <Card>
            <h2 className="font-display text-2xl text-navy-900">{dict.services.includesTitle}</h2>
            <ul className="mt-5 list-disc space-y-3 ps-5 text-sm leading-relaxed text-navy-700">
              {copy.includes.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </Card>
          <Card>
            <h2 className="font-display text-2xl text-navy-900">{dict.services.notIncludedTitle}</h2>
            <ul className="mt-5 list-disc space-y-3 ps-5 text-sm leading-relaxed text-navy-700">
              {copy.notIncluded.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <p className="mt-6 text-xs leading-relaxed text-navy-500">
              {legalAt(locale).disclaimer}
            </p>
          </Card>
        </div>
      </Container>
    </Section>
  );
}
