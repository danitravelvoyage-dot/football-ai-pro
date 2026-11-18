import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, formatDate, type Locale } from "@/lib/i18n";
import { getAdminCustomers } from "@/lib/queries";
import { formMessages } from "@/lib/validation/messages";
import { setCustomerActiveAction } from "@/lib/actions/admin";
import { ActionForm } from "@/components/forms/ActionForm";
import { Panel, DataTable } from "@/components/admin/AdminUI";
import { Badge } from "@/components/ui";

export const metadata: Metadata = { title: "Customers", robots: { index: false, follow: false } };

export default async function CustomersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const t = dict.admin.customersPage;
  const customers = await getAdminCustomers();

  return (
    <Panel title={`${t.title} (${customers.length})`}>
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
    </Panel>
  );
}
