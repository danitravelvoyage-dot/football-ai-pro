import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, formatDate, type Locale } from "@/lib/i18n";
import { getAdminApplications } from "@/lib/queries";
import { applicationStatuses, customerCategories, leadSources } from "@/lib/domain";
import { serviceTitle } from "@/lib/catalog";
import { Panel, DataTable } from "@/components/admin/AdminUI";
import { StatusBadge } from "@/components/StatusBadge";
import { Alert } from "@/components/ui";

export const metadata: Metadata = { title: "Applications", robots: { index: false, follow: false } };

const GROUPS = ["new", "pending", "in_progress", "approved", "rejected"] as const;

export default async function ApplicationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string; group?: string; source?: string; locale?: string; category?: string; q?: string; deleted?: string }>;
}) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const t = dict.admin.applicationsPage;
  const c = dict.crm;
  const f = await searchParams;
  const filters = {
    status: f.status ?? "",
    group: (GROUPS as readonly string[]).includes(f.group ?? "") ? f.group ?? "" : "",
    source: f.source ?? "",
    locale: f.locale ?? "",
    category: f.category ?? "",
    q: f.q ?? "",
  };
  const rows = await getAdminApplications(filters);

  return (
    <div className="space-y-6">
      {f.deleted === "1" && <Alert tone="success">{dict.admin.detail.deleted}</Alert>}
      <Panel title={`${t.title} (${rows.length})`}>
        <form method="get" className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-6 sm:items-end">
          <label className="block sm:col-span-2 xl:col-span-2">
            <span className="sr-only">{t.search}</span>
            <input name="q" defaultValue={filters.q} placeholder={t.search} className="w-full rounded-2xl border border-navy-200 px-4 py-3 text-base outline-none focus:border-gold-500 focus:ring-4 focus:ring-gold-300/40" />
          </label>
          <FilterSelect name="group" label={c.filterGroup} value={filters.group} all={dict.common.all}
            options={GROUPS.map((g) => ({ value: g, label: c.groupNames[g] }))} />
          <FilterSelect name="status" label={t.filterStatus} value={filters.status} all={dict.common.all}
            options={applicationStatuses.map((s) => ({ value: s, label: dict.statuses[s] }))} />
          <FilterSelect name="source" label={c.filterSource} value={filters.source} all={dict.common.all}
            options={[...leadSources, "not_recorded" as const].map((s) => ({ value: s, label: c.leadSources[s] }))} />
          <FilterSelect name="locale" label={c.filterLocale} value={filters.locale} all={dict.common.all}
            options={(["ar", "fr", "en"] as const).map((l) => ({ value: l, label: dict.langNames[l] }))} />
          <FilterSelect name="category" label={c.category} value={filters.category} all={dict.common.all}
            options={customerCategories.map((s) => ({ value: s, label: c.categories[s] }))} />
          <button type="submit" className="min-h-12 rounded-full bg-navy-900 px-6 py-3 font-semibold text-white hover:bg-navy-800 sm:col-span-2 xl:col-span-6 xl:w-fit">{t.filter}</button>
        </form>

        {rows.length === 0 ? (
          <p className="text-sm text-navy-600">{t.empty}</p>
        ) : (
          <DataTable head={[t.reference, t.customer, t.service, c.leadSource, t.submitted, ""]}>
            {rows.map((r) => (
              <tr key={r.id} className="align-top hover:bg-navy-50/50">
                <td className="px-4 py-3">
                  <Link href={`/${locale}/admin/applications/${r.id}`} className="font-mono font-semibold text-navy-900 hover:text-gold-600" dir="ltr">{r.reference}</Link>
                  <div className="mt-1"><StatusBadge status={r.status} dict={dict} /></div>
                </td>
                <td className="px-4 py-3">
                  <p className="font-semibold text-navy-900">{r.full_name}</p>
                  <p className="text-xs text-navy-500" dir="ltr">{r.email}</p>
                </td>
                <td className="px-4 py-3">{r.services ? serviceTitle(r.services, locale) : "—"}</td>
                <td className="px-4 py-3 text-navy-800">{r.lead_source ? c.leadSources[r.lead_source] : c.leadSources.not_recorded}</td>
                <td className="px-4 py-3 whitespace-nowrap">{formatDate(r.created_at, locale)}</td>
                <td className="px-4 py-3"><Link href={`/${locale}/admin/applications/${r.id}`} className="font-semibold text-gold-600 hover:text-gold-500">{dict.common.view} →</Link></td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
    </div>
  );
}

function FilterSelect({ name, label, value, all, options }: { name: string; label: string; value: string; all: string; options: { value: string; label: string }[] }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-navy-700">{label}</span>
      <select name={name} defaultValue={value} className="w-full rounded-2xl border border-navy-200 bg-white px-4 py-3 text-base outline-none focus:border-gold-500 focus:ring-4 focus:ring-gold-300/40">
        <option value="">{all}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
