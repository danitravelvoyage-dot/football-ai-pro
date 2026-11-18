import type { Metadata } from "next";
import { getDictionary, type Locale } from "@/lib/i18n";
import { getActiveServices } from "@/lib/queries";
import { Container, Section, SectionHeading, ButtonLink, EmptyState } from "@/components/ui";
import { ServiceCard } from "@/components/site/ServiceCard";
import { whatsappLink } from "@/lib/config";
import { applyHref } from "@/lib/catalog";

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }): Promise<Metadata> {
  const { locale } = await params;
  const dict = getDictionary(locale);
  return { title: dict.services.title, description: dict.services.subtitle };
}

export default async function ServicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ utm_source?: string }>;
}) {
  const { locale } = await params;
  const { utm_source: source } = await searchParams;
  const dict = getDictionary(locale);
  const services = await getActiveServices();
  const wa = whatsappLink(dict.services.contactForPrice);

  return (
    <Section className="pt-14 sm:pt-20">
      <Container>
        <SectionHeading eyebrow={dict.nav.services} title={dict.services.title} subtitle={dict.services.subtitle} />
        {services.length === 0 ? (
          <div className="mt-12">
            <EmptyState title={dict.services.noServices} action={wa ? <ButtonLink href={wa} external variant="whatsapp">{dict.footer.whatsapp}</ButtonLink> : null} />
          </div>
        ) : (
          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {services.map((service) => (
              <ServiceCard key={service.id} service={service} dict={dict} locale={locale} source={source} />
            ))}
          </div>
        )}
        <div className="mt-14 flex flex-col items-center gap-4 rounded-3xl bg-navy-950 p-8 text-center text-white sm:p-12">
          <p className="font-display text-2xl">{dict.home.finalTitle}</p>
          <ButtonLink href={applyHref(locale, { source })} variant="gold">{dict.home.finalCta}</ButtonLink>
        </div>
      </Container>
    </Section>
  );
}
