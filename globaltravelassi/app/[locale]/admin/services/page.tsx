import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, type Locale } from "@/lib/i18n";
import { getAdminServices } from "@/lib/queries";
import { servicePrice, serviceTitle } from "@/lib/catalog";
import { Panel, DataTable } from "@/components/admin/AdminUI";
import { Badge, buttonClass } from "@/components/ui";

export const metadata: Metadata = { title: "Services", robots: { index: false, follow: false } };

export default async function AdminServicesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const t = dict.admin.servicesPage;
  const services = await getAdminServices();

  return (
    <Panel
      title={t.title}
      action={<Link href={`/${locale}/admin/services/new`} className={buttonClass("navy", "min-h-10 px-5 py-2 text-sm")}>{t.add}</Link>}
    >
      <p className="mb-5 text-sm text-navy-600">{t.priceHelp}</p>
      {services.length === 0 ? (
        <p className="text-sm text-navy-600">{t.empty}</p>
      ) : (
        <DataTable head={[dict.admin.servicesPage.category, t.titleEn, t.price, t.active, ""]}>
          {services.map((s) => (
            <tr key={s.id} className="hover:bg-navy-50/50">
              <td className="px-4 py-3"><Badge tone="gold">{dict.categories[s.category]}</Badge></td>
              <td className="px-4 py-3 font-semibold text-navy-900">{serviceTitle(s, locale)}<p className="text-xs font-normal text-navy-500" dir="ltr">{s.slug}</p></td>
              <td className="px-4 py-3">{servicePrice(s, dict, locale)}</td>
              <td className="px-4 py-3"><Badge tone={s.is_active ? "success" : "neutral"}>{s.is_active ? dict.common.active : dict.common.inactive}</Badge></td>
              <td className="px-4 py-3"><Link href={`/${locale}/admin/services/${s.id}`} className="font-semibold text-gold-600 hover:text-gold-500">{dict.common.edit} →</Link></td>
            </tr>
          ))}
        </DataTable>
      )}
    </Panel>
  );
}
