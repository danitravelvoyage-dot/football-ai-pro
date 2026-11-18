import Link from "next/link";
import { headers } from "next/headers";
import { getDictionary, isLocale, type Locale } from "@/lib/i18n";
import { ButtonLink, Container, Section } from "@/components/ui";

export default async function NotFound() {
  const requested = (await headers()).get("x-locale") ?? "ar";
  const locale: Locale = isLocale(requested) ? requested : "ar";
  const dict = getDictionary(locale);
  return (
    <Section className="py-24">
      <Container className="text-center">
        <p className="font-display text-7xl text-gold-500">404</p>
        <h1 className="mt-4 font-display text-3xl text-navy-900">{dict.notFound.title}</h1>
        <p className="mx-auto mt-3 max-w-md text-navy-600">{dict.notFound.text}</p>
        <div className="mt-8"><ButtonLink href={`/${locale}`}>{dict.notFound.back}</ButtonLink></div>
        <Link href={`/${locale}/services`} className="sr-only">{dict.nav.services}</Link>
      </Container>
    </Section>
  );
}
