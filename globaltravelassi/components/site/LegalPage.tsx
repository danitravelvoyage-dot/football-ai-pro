import type { Locale } from "@/lib/i18n/config";
import { fillLegal, LEGAL_UPDATED, type LegalPage as Page } from "@/lib/legal/content";
import { siteConfig } from "@/lib/config";
import { Container, Section } from "@/components/ui";

/** Renders one legal page. Placeholders are filled from public configuration only. */
export function LegalPage({ page, locale }: { page: Page; locale: Locale }) {
  const contact = { email: siteConfig.contactEmail, whatsapp: siteConfig.whatsappNumber };
  const dir = locale === "ar" ? "rtl" : "ltr";
  return (
    <Section>
      <Container className="max-w-3xl" >
        <article dir={dir} className="space-y-10">
          <header>
            <h1 className="font-display text-4xl font-semibold text-navy-900">{page.title}</h1>
            <p className="mt-3 text-sm text-navy-500">{updatedLabel(locale)}: {LEGAL_UPDATED}</p>
            <span className="gold-rule mt-5 block h-px w-16" aria-hidden />
            <p className="mt-6 text-base leading-loose text-navy-700">{page.intro}</p>
          </header>
          {page.sections.map((section) => (
            <section key={section.heading} className="space-y-4">
              <h2 className="font-display text-2xl text-navy-900">{section.heading}</h2>
              {section.paragraphs.map((p, i) => (
                <p key={i} className="text-base leading-loose text-navy-700">{fillLegal(p, contact)}</p>
              ))}
            </section>
          ))}
        </article>
      </Container>
    </Section>
  );
}

function updatedLabel(locale: Locale): string {
  return locale === "ar" ? "آخر تحديث" : locale === "fr" ? "Dernière mise à jour" : "Last updated";
}
