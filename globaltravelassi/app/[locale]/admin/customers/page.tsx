import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, formatDate, type Locale } from "@/lib/i18n";
import { getAdminCustomers } from "@/lib/queries";
import { formMessages } from "@/lib/validation/messages";
import { setCustomerActiveAction } from "@/lib/actions/admin";
import { ActionForm } from "@/components/forms/ActionForm";
import { Panel, DataTable } from "@/components/admin/AdminUI";
import { Pagination } from "@/components/admin/Pagination";
import { Badge } from "@/components/ui";
import { parsePage } from "@/lib/pagination";

export const metadata: Metadata = { title: "Customers", robots: { index: false, follow: false } };

export default async function CustomersPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const t = dict.admin.customersPage;
  const f = await searchParams;
  const q = f.q ?? "";
  const { rows: customers, info } = await getAdminCustomers({ q, page: parsePage(f.page) });

  return (
    <Panel title={`${t.title} (${info.total})`}>
      <form method="get" className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="block flex-1">
          <span className="sr-only">{dict.common.search}</span>
          <input name="q" defaultValue={q} placeholder={dict.common.search} className="w-full rounded-2xl border border-navy-200 bg-white px-4 py-3 text-base outline-none focus:border-gold-500 focus:ring-4 focus:ring-gold-300/40" />
        </label>
        <button type="submit" className="min-h-12 rounded-full bg-navy-900 px-6 py-3 font-semibold text-white hover:bg-navy-800">{dict.admin.applicationsPage.filter}</button>
      </form>
      {customers.length === 0 ? (
        <p className="text-sm text-navy-600">{t.empty}</p>
      ) : (
        <DataTable head={[t.name, t.email, t.whatsapp, t.joined, t.requests, t.active]}>
          {customers.map((c) => (
            <tr key={c.id} className="align-middle">
              <td className="px-4 py-3 font-semibold text-navy-900">
                {c.full_name || "—"}
                {c.role === "admin" && <span className="ms-2"><Badge tone="gold">{t.admin}</Badge></span>}
              </td>
              <td className="px-4 py-3" dir="ltr">{c.email}</td>
              <td className="px-4 py-3" dir="ltr">{c.whatsapp || "—"}</td>
              <td className="px-4 py-3 whitespace-nowrap">{formatDate(c.created_at, locale)}</td>
              <td className="px-4 py-3 text-center font-semibold">{c.requestCount}</td>
              <td className="px-4 py-3">
                {c.role === "admin" ? (
                  <span className="text-navy-500">—</span>
                ) : (
                  <div className="flex items-center gap-3">
                    <Badge tone={c.is_active ? "success" : "danger"}>{c.is_active ? dict.common.active : dict.common.inactive}</Badge>
                    <ActionForm
                      action={setCustomerActiveAction}
                      messages={formMessages(dict)}
                      submitLabel={c.is_active ? t.deactivate : t.activate}
                      pendingLabel={dict.common.loading}
                      submitVariant="navy"
                      confirmMessage={c.is_active ? t.confirmDeactivate : undefined}
                      className="inline"
                    >
                      <input type="hidden" name="profileId" value={c.id} />
                      <input type="hidden" name="active" value={c.is_active ? "false" : "true"} />
                    </ActionForm>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      )}
      <Pagination info={info} basePath={`/${locale}/admin/customers`} params={{ q }} dict={dict} />
    </Panel>
  );
}
