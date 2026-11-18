import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, type Locale } from "@/lib/i18n";
import { requireCustomer } from "@/lib/auth";
import { Container, Section, ButtonLink } from "@/components/ui";

export default async function DashboardLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  await requireCustomer(locale, `/${locale}/dashboard`);
  return (
    <Section className="pt-10 sm:pt-14">
      <Container>
        <nav aria-label={dict.nav.dashboard} className="mb-8 flex flex-wrap items-center gap-2 border-b border-navy-100 pb-4 text-sm font-semibold">
          <Link href={`/${locale}/dashboard`} className="rounded-full px-4 py-2 text-navy-700 hover:bg-navy-50">{dict.nav.dashboard}</Link>
          <Link href={`/${locale}/dashboard/profile`} className="rounded-full px-4 py-2 text-navy-700 hover:bg-navy-50">{dict.nav.profile}</Link>
          <div className="ms-auto">
            <ButtonLink href={`/${locale}/apply`} variant="navy" className="min-h-10 px-5 py-2 text-sm">{dict.dashboard.newRequest}</ButtonLink>
          </div>
        </nav>
        {children}
      </Container>
    </Section>
  );
}
