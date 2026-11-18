import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, type Locale } from "@/lib/i18n";
import { requireAdmin } from "@/lib/auth";
import { Container, Section } from "@/components/ui";
import { AdminNav } from "@/components/admin/AdminUI";

export default async function AdminLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const { profile } = await requireAdmin(locale, `/${locale}/admin`);

  return (
    <Section className="bg-navy-50/40 pt-8 sm:pt-12">
      <Container>
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gold-600">{dict.admin.title}</p>
            <p className="mt-1 text-sm text-navy-600">{dict.admin.signedInAs}: <span dir="ltr" className="font-semibold">{profile.email}</span></p>
          </div>
          <Link href={`/${locale}`} className="text-sm font-semibold text-navy-700 hover:text-gold-600">{dict.admin.backToSite} →</Link>
        </div>
        <div className="grid gap-8 lg:grid-cols-[14rem_1fr]">
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <AdminNav locale={locale} dict={dict} current="" />
          </aside>
          <div className="min-w-0 space-y-8">{children}</div>
        </div>
      </Container>
    </Section>
  );
}
