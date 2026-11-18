import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, formatMoney, type Locale } from "@/lib/i18n";
import { getReportData } from "@/lib/queries";
import { applicationStatuses } from "@/lib/domain";
import { Bar, DataTable, Panel } from "@/components/admin/AdminUI";
import { buttonClass } from "@/components/ui";

export const metadata: Metadata = { title: "Reports", robots: { index: false, follow: false } };

export default async function ReportsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const t = dict.admin.reportsPage;
  const report = await getReportData();
  const maxStatus = Math.max(1, ...applicationStatuses.map((s) => report.byStatus[s]));
  const maxService = Math.max(1, ...report.byService.map((s) => s.requests));
  const totals = Object.entries(report.receivedByCurrency);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold text-navy-900">{t.title}</h1>
        <a href={`/${locale}/admin/reports/export`} className={buttonClass("navy", "min-h-11 px-5 py-2 text-sm")}>{t.exportCsv}</a>
      </div>

      <Panel title={t.totalsByCurrency}>
        {totals.length === 0 ? (
          <p className="text-sm text-navy-600">{t.noData}</p>
        ) : (
          <div className="flex flex-wrap gap-4">
            {totals.map(([c, v]) => (
              <div key={c} className="rounded-2xl bg-emerald-50 px-6 py-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">{c}</p>
                <p className="mt-1 font-display text-2xl text-emerald-950">{formatMoney(v, c, locale)}</p>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title={t.byMonth}>
        {report.byMonth.length === 0 ? (
          <p className="text-sm text-navy-600">{t.noData}</p>
        ) : (
          <DataTable head={[t.month, t.requests, t.received]}>
            {report.byMonth.map((m) => (
              <tr key={m.month}>
                <td className="px-4 py-3 font-semibold text-navy-900" dir="ltr">{m.month}</td>
                <td className="px-4 py-3">{m.requests}</td>
                <td className="px-4 py-3">{Object.entries(m.received).map(([c, v]) => formatMoney(v, c, locale)).join(" · ") || "—"}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <div className="grid gap-8 lg:grid-cols-2">
        <Panel title={t.byStatus}>
          <div className="space-y-4">
            {applicationStatuses.map((s) => <Bar key={s} label={dict.statuses[s]} value={report.byStatus[s]} max={maxStatus} />)}
          </div>
        </Panel>
        <Panel title={t.byService}>
          {report.byService.length === 0 ? (
            <p className="text-sm text-navy-600">{t.noData}</p>
          ) : (
            <div className="space-y-4">
              {report.byService.map((s) => <Bar key={s.title} label={s.title} value={s.requests} max={maxService} />)}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
