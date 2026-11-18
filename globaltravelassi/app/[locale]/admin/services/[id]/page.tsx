import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, type Locale } from "@/lib/i18n";
import { getAdminService } from "@/lib/queries";
import { Panel } from "@/components/admin/AdminUI";
import { ServiceForm } from "@/components/admin/ServiceForm";

export const metadata: Metadata = { title: "Edit service", robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditServicePage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale: raw, id } = await params;
  if (!isLocale(raw) || !UUID.test(id)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const service = await getAdminService(id);
  if (!service) notFound();
  return (
    <Panel title={dict.admin.servicesPage.edit} action={<Link href={`/${locale}/admin/services`} className="text-sm font-semibold text-navy-600">← {dict.common.back}</Link>}>
      <ServiceForm dict={dict} locale={locale} service={service} />
    </Panel>
  );
}
