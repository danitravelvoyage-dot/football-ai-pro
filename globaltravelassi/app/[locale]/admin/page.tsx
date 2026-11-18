import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, formatMoney, formatDate, type Locale } from "@/lib/i18n";
import { getAdminOverview } from "@/lib/queries";
import { applicationStatuses } from "@/lib/domain";
import { serviceTitle } from "@/lib/catalog";
import { StatCard, Panel, Bar, DataTable } from "@/components/admin/AdminUI";
import { StatusBadge } from "@/components/StatusBadge";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

export default async function AdminOverviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const o = await getAdminOverview();
  const maxStatus = Math.max(1, ...applicationStatuses.map((s) => o.byStatus[s]));
  const received = Object.entries(o.receivedByCurrency);

  return (
    <>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
        <StatCard label={dict.admin.stats.total} value={o.total} />
        <StatCard label={dict.admin.stats.newWeek} value={o.newThisWeek} />
        <StatCard label={dict.admin.stats.awaitingDocs} value={o.awaitingDocs} />
        <StatCard label={dict.admin.stats.customers} value={o.customers} />
        <StatCard
          label={dict.admin.stats.revenue}
          value={received.length ? received.map(([c, v]) => formatMoney(v, c, locale)).join(" · ") : "—"}
          hint={dict.admin.detail.balanceNote}
        />
        <StatCard label={dict.admin.stats.pendingPayments} value={o.pendingPayments} />
      </div>

      <div className="grid gap-8 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Panel title={dict.admin.byStatus}>
            <div className="space-y-4">
              {applicationStatuses.map((s) => (
                <Bar key={s} label={dict.statuses[s]} value={o.byStatus[s]} max={maxStatus} />
              ))}
            </div>
          </Panel>
        </div>
        <div className="lg:col-span-3">
          <Panel title={dict.admin.recent} action={<Link href={`/${locale}/admin/applications`} className="text-sm font-semibold text-gold-600 hover:text-gold-500">{dict.admin.viewAll} →</Link>}>
            {o.recent.length === 0 ? (
              <p className="text-sm text-navy-600">{dict.admin.applicationsPage.empty}</p>
            ) : (
              <DataTable head={[dict.admin.applicationsPage.reference, dict.admin.applicationsPage.customer, dict.admin.applicationsPage.service, dict.admin.applicationsPage.submitted]}>
                {o.recent.map((r) => (
                  <tr key={r.id} className="hover:bg-navy-50/50">
                    <td className="px-4 py-3"><Link className="font-mono font-semibold text-navy-900 hover:text-gold-600" href={`/${locale}/admin/applications/${r.id}`}>{r.reference}</Link><div className="mt-1"><StatusBadge status={r.status} dict={dict} /></div></td>
                    <td className="px-4 py-3">{r.full_name}</td>
                    <td className="px-4 py-3">{r.services ? serviceTitle(r.services, locale) : "—"}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatDate(r.created_at, locale)}</td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
