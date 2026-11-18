import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, type Locale } from "@/lib/i18n";
import { Panel } from "@/components/admin/AdminUI";
import { ServiceForm } from "@/components/admin/ServiceForm";

export const metadata: Metadata = { title: "New service", robots: { index: false, follow: false } };

export default async function NewServicePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  return (
    <Panel title={dict.admin.servicesPage.add} action={<Link href={`/${locale}/admin/services`} className="text-sm font-semibold text-navy-600">← {dict.common.back}</Link>}>
      <ServiceForm dict={dict} locale={locale} />
    </Panel>
  );
}
