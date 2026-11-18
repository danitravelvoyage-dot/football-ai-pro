import { getDictionary, isLocale, type Locale } from "@/lib/i18n";
import { Container, Section } from "@/components/ui";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: raw } = await params;
  return { title: getDictionary(isLocale(raw) ? (raw as Locale) : "ar").privacy.title };
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const dict = getDictionary(raw as Locale);
  return (
    <Section>
      <Container className="max-w-3xl">
        <h1 className="font-display text-4xl font-semibold text-navy-900">{dict.privacy.title}</h1>
        <span className="gold-rule mt-5 block h-px w-16" aria-hidden />
        <p className="mt-8 text-base leading-loose text-navy-700">{dict.privacy.body}</p>
      </Container>
    </Section>
  );
}
