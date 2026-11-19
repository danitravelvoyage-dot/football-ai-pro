import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, FileCheck2, MessageCircle, ShieldCheck, Sparkles } from "lucide-react";
import { getDictionary, isLocale, type Locale } from "@/lib/i18n";
import { getActiveServices } from "@/lib/queries";
import { applyHref } from "@/lib/catalog";
import { whatsappLink, siteConfig } from "@/lib/config";
import { Container, Section, SectionHeading, ButtonLink } from "@/components/ui";
import { CinematicBackdrop } from "@/components/site/CinematicBackdrop";
import { ServiceCard } from "@/components/site/ServiceCard";
import { Reveal } from "@/components/Reveal";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : "ar";
  const dict = getDictionary(locale);
  return { title: { absolute: "GLOBALTRAVELASSI" }, description: dict.brand.tagline };
}

const trustIcons = [FileCheck2, MessageCircle, ShieldCheck];

export default async function HomePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ utm_source?: string }>;
}) {
  const { locale: raw } = await params;
  const locale = raw as Locale;
  const { utm_source: source } = await searchParams;
  const dict = getDictionary(locale);
  const services = await getActiveServices();
  const wa = whatsappLink(dict.home.whatsappCta);
  const start = applyHref(locale, { source });

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "TravelAgency",
    name: siteConfig.name,
    url: `${siteConfig.siteUrl}/${locale}`,
    description: dict.brand.tagline,
    areaServed: ["DZ", "MA", "TN", "FR", "ES", "IT"],
    inLanguage: locale,
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Hero: the conversion headline and the two actions that matter */}
      <section className="relative isolate flex min-h-[88svh] items-center overflow-hidden bg-navy-950 pb-40 pt-16 text-white sm:pt-24">
        <CinematicBackdrop />
        <Container className="relative grid items-center gap-12 lg:grid-cols-[1.25fr_1fr]">
          <div className="max-w-3xl">
            <p className="animate-fadeUp mb-5 inline-flex items-center gap-2 rounded-full border border-gold-400/40 bg-gold-400/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-gold-300">
              <Sparkles className="size-3.5" aria-hidden /> {dict.home.eyebrow}
            </p>
            <h1 className="animate-fadeUp font-display text-4xl font-semibold leading-[1.12] sm:text-6xl" style={{ animationDelay: "120ms" }}>
              {dict.home.title}
            </h1>
            <p className="animate-fadeUp mt-6 max-w-2xl text-base leading-relaxed text-navy-100 sm:text-xl" style={{ animationDelay: "240ms" }}>
              {dict.home.subtitle}
            </p>
            <div className="animate-fadeUp mt-9 flex flex-col gap-3 sm:flex-row sm:items-center" style={{ animationDelay: "360ms" }}>
              <ButtonLink href={start} variant="gold" className="w-full sm:w-auto">
                {dict.home.primaryCta} <ArrowRight className="size-5 rtl:rotate-180" aria-hidden />
              </ButtonLink>
              {wa && (
                <ButtonLink href={wa} variant="outline" external className="w-full sm:w-auto">
                  <MessageCircle className="size-5" aria-hidden /> {dict.home.whatsappCta}
                </ButtonLink>
              )}
            </div>
            <ul className="animate-fadeUp mt-10 grid gap-3 text-sm text-navy-100 sm:grid-cols-3" style={{ animationDelay: "480ms" }}>
              {dict.home.trust.map((item, i) => {
                const Icon = trustIcons[i];
                return (
                  <li key={item.title} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
                    <Icon className="mt-0.5 size-5 shrink-0 text-gold-400" aria-hidden />
                    <span className="font-semibold text-white">{item.title}</span>
                  </li>
                );
              })}
            </ul>
          </div>
          <aside aria-label={dict.home.stepsTitle} className="animate-fadeUp hidden rounded-[2rem] border border-gold-400/25 bg-white/[0.04] p-8 shadow-2xl shadow-black/40 backdrop-blur-md lg:block" style={{ animationDelay: "600ms" }}>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gold-400">{dict.home.stepsTitle}</p>
            <ol className="mt-6 space-y-6">
              {dict.home.steps.map((step, i) => (
                <li key={step.title} className="flex gap-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-gold-400/60 font-display text-gold-300">{i + 1}</span>
                  <div>
                    <p className="font-semibold text-white">{step.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-navy-200">{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </aside>
        </Container>
      </section>

      {/* Services */}
      <Section id="services" className="-mt-24 relative z-10">
        <Container>
          <Reveal>
            <SectionHeading eyebrow={dict.nav.services} title={dict.home.servicesTitle} subtitle={dict.home.servicesSubtitle} />
          </Reveal>
          {services.length === 0 ? (
            <p className="mt-10 rounded-3xl border border-navy-100 bg-navy-50/60 p-8 text-navy-700">{dict.services.noServices}</p>
          ) : (
            <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {services.map((service, i) => (
                <Reveal key={service.id} delay={(i % 3) * 90}>
                  <ServiceCard service={service} dict={dict} locale={locale} source={source} />
                </Reveal>
              ))}
            </div>
          )}
        </Container>
      </Section>

      {/* How it works */}
      <Section dark className="overflow-hidden">
        <Container>
          <Reveal>
            <SectionHeading dark eyebrow={dict.nav.apply} title={dict.home.stepsTitle} />
          </Reveal>
          <ol className="mt-12 grid gap-6 md:grid-cols-3">
            {dict.home.steps.map((step, i) => (
              <Reveal key={step.title} delay={i * 120}>
                <li className="h-full rounded-3xl border border-white/10 bg-white/[0.03] p-8">
                  <span className="flex size-12 items-center justify-center rounded-full border border-gold-400/60 font-display text-lg text-gold-300">{i + 1}</span>
                  <h3 className="mt-6 font-display text-2xl text-white">{step.title}</h3>
                  <p className="mt-3 leading-relaxed text-navy-200">{step.text}</p>
                </li>
              </Reveal>
            ))}
          </ol>
        </Container>
      </Section>

      {/* European journeys */}
      <section className="relative isolate overflow-hidden bg-navy-950 py-20 text-white sm:py-28">
        <CinematicBackdrop variant="band" />
        <Container className="relative">
          <Reveal className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gold-400">{dict.services.title}</p>
            <h2 className="mt-4 font-display text-3xl font-semibold leading-tight sm:text-5xl">
              <span className="gold-text">{dict.home.europeTitle}</span>
            </h2>
            <p className="mt-6 text-base leading-relaxed text-navy-100 sm:text-lg">{dict.home.europeText}</p>
            <div className="mt-8">
              <ButtonLink href={applyHref(locale, { service: "european-trips", source })} variant="gold">
                {dict.home.europeCta} <ArrowRight className="size-5 rtl:rotate-180" aria-hidden />
              </ButtonLink>
            </div>
          </Reveal>
        </Container>
      </section>

      {/* Final call to action */}
      <Section>
        <Container>
          <Reveal>
            <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-gold-300 via-gold-400 to-gold-500 p-10 text-navy-950 sm:p-16">
              <h2 className="font-display text-3xl font-semibold leading-tight sm:text-5xl">{dict.home.finalTitle}</h2>
              <p className="mt-4 max-w-2xl text-base leading-relaxed text-navy-800 sm:text-lg">{dict.home.finalText}</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href={start} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-navy-950 px-7 py-3 font-semibold text-white transition hover:-translate-y-0.5">
                  {dict.home.finalCta} <ArrowRight className="size-5 rtl:rotate-180" aria-hidden />
                </Link>
                {wa && (
                  <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-navy-900/30 px-7 py-3 font-semibold text-navy-950 transition hover:bg-white/30">
                    <MessageCircle className="size-5" aria-hidden /> {dict.home.whatsappCta}
                  </a>
                )}
              </div>
            </div>
          </Reveal>
          <p className="mt-10 text-center text-xs leading-relaxed text-navy-500">{dict.home.disclaimer}</p>
        </Container>
      </Section>
    </>
  );
}
