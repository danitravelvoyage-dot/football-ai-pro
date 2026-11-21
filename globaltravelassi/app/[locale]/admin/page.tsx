import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, formatDate, type Locale } from "@/lib/i18n";
import { getAdminOverview, getCustomerCountsBySource, statusGroups } from "@/lib/queries";
import { applicationStatuses, leadSources } from "@/lib/domain";
import { serviceTitle } from "@/lib/catalog";
import { StatCard, Panel, Bar, DataTable } from "@/components/admin/AdminUI";
import { StatusBadge } from "@/components/StatusBadge";
import { Alert } from "@/components/ui";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

export default async function AdminOverviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const c = dict.crm;
  const [o, customersBySource] = await Promise.all([getAdminOverview(), getCustomerCountsBySource()]);
  const maxStatus = Math.max(1, ...applicationStatuses.map((s) => o.byStatus[s]));
  const maxSource = Math.max(1, ...Object.values(o.byLeadSource));
  const localeNames = dict.langNames;

  return (
    <>
      {o.groups.new > 0 && (
        <Alert tone="warning">
          {c.newAlert}: {o.groups.new} · <Link href={`/${locale}/admin/applications?group=new`} className="font-semibold underline">{c.viewNew}</Link>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
        <StatCard label={c.totalRequests} value={o.total} />
        <StatCard label={c.newRequests} value={o.groups.new} />
        <StatCard label={c.inProgress} value={o.groups.in_progress + o.groups.pending} hint={c.pendingHint} />
        <StatCard label={c.completedRequests} value={o.groups.approved} />
        <StatCard label={c.rejectedRequests} value={o.groups.rejected} />
        <StatCard label={c.totalCustomers} value={o.customers} />
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <Panel title={c.groupsTitle}>
          <div className="space-y-4">
            {applicationStatuses.map((s) => (
              <Bar key={s} label={`${dict.statuses[s]} · ${c.groupNames[statusGroups[s]]}`} value={o.byStatus[s]} max={maxStatus} />
            ))}
          </div>
        </Panel>
        <Panel title={c.bySource}>
          <div className="space-y-4">
            {[...leadSources, "not_recorded" as const].map((s) => (
              <Bar key={s} label={`${c.leadSources[s]} · ${o.byLeadSource[s] ?? 0} · ${c.customersLabel}: ${customersBySource[s] ?? 0}`} value={o.byLeadSource[s] ?? 0} max={maxSource} />
            ))}
          </div>
          <p className="mt-6 text-xs leading-relaxed text-navy-500">{c.notMeasurable}</p>
        </Panel>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <Panel title={c.byService}>
          {o.byService.length === 0 ? (
            <p className="text-sm text-navy-600">{dict.admin.applicationsPage.empty}</p>
          ) : (
            <ul className="divide-y divide-navy-100 text-sm">
              {o.byService.map((row) => (
                <li key={row.title} className="flex justify-between py-2"><span>{row.title}</span><span className="font-semibold">{row.count}</span></li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={c.byLocale}>
          <ul className="divide-y divide-navy-100 text-sm">
            {(["ar", "fr", "en"] as const).map((l) => (
              <li key={l} className="flex justify-between py-2"><span>{localeNames[l]}</span><span className="font-semibold">{o.byLocale[l] ?? 0}</span></li>
            ))}
          </ul>
        </Panel>
      </div>

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
    </>
  );
}
