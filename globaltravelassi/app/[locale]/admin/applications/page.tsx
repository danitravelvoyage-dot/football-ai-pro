import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, formatDate, formatMoney, type Locale } from "@/lib/i18n";
import { getAdminApplications } from "@/lib/queries";
import { applicationStatuses } from "@/lib/domain";
import { serviceTitle } from "@/lib/catalog";
import { Panel, DataTable } from "@/components/admin/AdminUI";
import { StatusBadge } from "@/components/StatusBadge";
import { Alert } from "@/components/ui";

export const metadata: Metadata = { title: "Applications", robots: { index: false, follow: false } };

function receivedText(payments: { amount: string | number; currency: string; status: string }[], locale: Locale): string {
  const totals: Record<string, number> = {};
  for (const p of payments) if (p.status === "received") totals[p.currency] = (totals[p.currency] ?? 0) + Number(p.amount);
  const parts = Object.entries(totals).map(([currency, value]) => formatMoney(value, currency, locale));
  return parts.length ? parts.join(" · ") : "—";
}

export default async function ApplicationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string; q?: string; deleted?: string }>;
}) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const t = dict.admin.applicationsPage;
  const { status = "", q = "", deleted } = await searchParams;
  const rows = await getAdminApplications({ status, q });

  return (
    <div className="space-y-6">
      {deleted === "1" && <Alert tone="success">{dict.admin.detail.deleted}</Alert>}
      <Panel title={`${t.title} (${rows.length})`}>
        <form method="get" className="mb-6 grid gap-3 sm:grid-cols-[1fr_14rem_auto] sm:items-end">
          <label className="block">
            <span className="sr-only">{t.search}</span>
            <input name="q" defaultValue={q} placeholder={t.search} className="w-full rounded-2xl border border-navy-200 px-4 py-3 text-base outline-none focus:border-gold-500 focus:ring-4 focus:ring-gold-300/40" />
          </label>
          <label className="block">
            <span className="sr-only">{t.filterStatus}</span>
            <select name="status" defaultValue={status} className="w-full rounded-2xl border border-navy-200 bg-white px-4 py-3 text-base outline-none focus:border-gold-500 focus:ring-4 focus:ring-gold-300/40">
              <option value="">{dict.common.all} — {t.filterStatus}</option>
              {applicationStatuses.map((s) => <option key={s} value={s}>{dict.statuses[s]}</option>)}
            </select>
          </label>
          <button type="submit" className="min-h-12 rounded-full bg-navy-900 px-6 py-3 font-semibold text-white hover:bg-navy-800">{t.filter}</button>
        </form>

        {rows.length === 0 ? (
          <p className="text-sm text-navy-600">{t.empty}</p>
        ) : (
          <DataTable head={[t.reference, t.customer, t.service, t.submitted, t.paid, ""]}>
            {rows.map((r) => (
              <tr key={r.id} className="align-top hover:bg-navy-50/50">
                <td className="px-4 py-3">
                  <Link href={`/${locale}/admin/applications/${r.id}`} className="font-mono font-semibold text-navy-900 hover:text-gold-600">{r.reference}</Link>
                  <div className="mt-1"><StatusBadge status={r.status} dict={dict} /></div>
                </td>
                <td className="px-4 py-3">
                  <p className="font-semibold text-navy-900">{r.full_name}</p>
                  <p className="text-xs text-navy-500" dir="ltr">{r.email}</p>
                </td>
                <td className="px-4 py-3">{r.services ? serviceTitle(r.services, locale) : "—"}</td>
                <td className="px-4 py-3 whitespace-nowrap">{formatDate(r.created_at, locale)}</td>
                <td className="px-4 py-3 font-semibold text-navy-900">{receivedText(r.payments ?? [], locale)}</td>
                <td className="px-4 py-3"><Link href={`/${locale}/admin/applications/${r.id}`} className="font-semibold text-gold-600 hover:text-gold-500">{dict.common.view} →</Link></td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
    </div>
  );
}
