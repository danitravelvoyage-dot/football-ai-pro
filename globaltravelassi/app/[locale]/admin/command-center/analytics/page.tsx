import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, type Locale } from "@/lib/i18n";
import { loadAnalytics } from "@/lib/ai/analytics/load";
import { PERIODS, type Period } from "@/lib/ai/analytics/engine";
import { Alert } from "@/components/ui";
import { DataTable, Panel, StatCard } from "@/components/admin/AdminUI";
import { LoadState } from "@/components/admin/command-center/Parts";

export const metadata: Metadata = { title: "Analytics", robots: { index: false, follow: false } };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AnalyticsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Search }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const a = dict.commandCenter.analyticsUi;
  const sp = await searchParams;
  const period: Period = PERIODS.find((p) => p === one(sp.period)) ?? "monthly";

  const state = await loadAnalytics(period);
  if (state.status === "unauthorized") return <p className="text-sm text-rose-800">{a.unauthorized}</p>;
  if (state.status !== "ok") return <LoadState kind={state.status} dict={dict} />;

  const pct = (v: number | null) => (v === null ? a.unknown : `${v}%`);
  const money = (rec: Record<string, number>) => (Object.keys(rec).length === 0 ? a.none : Object.entries(rec).map(([c, v]) => `${v.toLocaleString(locale)} ${c}`).join(" · "));

  return (
    <>
      <p className="text-sm leading-relaxed text-navy-600">{a.hint}</p>
      <nav aria-label={a.periodLabel} className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <a key={p} href={`?period=${p}`} aria-current={p === period ? "page" : undefined} className={`rounded-full px-4 py-2 text-sm font-semibold ring-1 ring-inset ${p === period ? "bg-navy-900 text-white ring-navy-900" : "text-navy-800 ring-navy-200 hover:ring-gold-300"}`}>
            {a.periods[p]}
          </a>
        ))}
      </nav>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label={a.approvalRate} value={pct(state.approvals.approvalRate)} />
        <StatCard label={a.leadConversion} value={pct(state.leads.conversionRate)} />
        <StatCard label={a.revenue} value={money(state.revenue.receivedByCurrency)} />
        <StatCard label={a.executionCost} value={!state.cost.complete || state.cost.totalCost === null ? a.unknown : state.cost.totalCost} />
      </div>

      {!state.cost.complete ? <Alert tone="warning">{a.costIncomplete}</Alert> : null}

      <Panel title={a.approvalsTitle}>
        {state.approvals.byClass.length === 0 ? <p className="text-sm text-navy-600">{a.none}</p> : (
          <DataTable head={[a.actionClass, a.requested, a.decided, a.approved, a.approvalRate]}>
            {state.approvals.byClass.map((r) => (
              <tr key={r.actionClass} className="hover:bg-navy-50/50">
                <td className="px-4 py-3 font-mono text-xs text-navy-800" dir="ltr">{r.actionClass}</td>
                <td className="px-4 py-3 text-sm text-navy-800">{r.requested}</td>
                <td className="px-4 py-3 text-sm text-navy-800">{r.decided}</td>
                <td className="px-4 py-3 text-sm text-navy-800">{r.approved}</td>
                <td className="px-4 py-3 text-sm text-navy-800">{pct(r.approvalRate)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <Panel title={a.contentTitle}>
        {state.content.length === 0 ? <p className="text-sm text-navy-600">{a.none}</p> : (
          <DataTable head={[a.kind, a.produced, a.approved, a.rejected, a.waiting, a.approvalRate]}>
            {state.content.map((r) => (
              <tr key={r.kind} className="hover:bg-navy-50/50">
                <td className="px-4 py-3 font-mono text-xs text-navy-800" dir="ltr">{r.kind}</td>
                <td className="px-4 py-3 text-sm text-navy-800">{r.produced}</td>
                <td className="px-4 py-3 text-sm text-navy-800">{r.approved}</td>
                <td className="px-4 py-3 text-sm text-navy-800">{r.rejected}</td>
                <td className="px-4 py-3 text-sm text-navy-800">{r.waiting}</td>
                <td className="px-4 py-3 text-sm text-navy-800">{pct(r.approvalRate)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <Panel title={a.agentsTitle}>
        {state.agents.length === 0 ? <p className="text-sm text-navy-600">{a.none}</p> : (
          <DataTable head={[a.period, a.agent, a.runs, a.failureRate, a.avgDuration]}>
            {state.agents.map((r) => (
              <tr key={`${r.agent}-${r.period}`} className="hover:bg-navy-50/50">
                <td className="px-4 py-3 font-mono text-xs text-navy-800" dir="ltr">{r.period}</td>
                <td className="px-4 py-3 font-mono text-xs text-navy-800" dir="ltr">{r.agent}</td>
                <td className="px-4 py-3 text-sm text-navy-800">{r.runs}</td>
                <td className="px-4 py-3 text-sm text-navy-800">{pct(r.failureRate)}</td>
                <td className="px-4 py-3 text-sm text-navy-800">{r.avgDurationMs} ms</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <Panel title={a.leadsTitle}>
        <p className="mb-3 text-sm text-navy-700">{a.leadsSummary}: {state.leads.leads} · {a.concluded}: {state.leads.concluded} · {a.converted}: {state.leads.converted}</p>
        <DataTable head={[a.period, a.leads, a.converted, a.conversionRate]}>
          {state.leads.byPeriod.map((r) => (
            <tr key={r.period} className="hover:bg-navy-50/50">
              <td className="px-4 py-3 font-mono text-xs text-navy-800" dir="ltr">{r.period}</td>
              <td className="px-4 py-3 text-sm text-navy-800">{r.leads}</td>
              <td className="px-4 py-3 text-sm text-navy-800">{r.converted}</td>
              <td className="px-4 py-3 text-sm text-navy-800">{pct(r.conversionRate)}</td>
            </tr>
          ))}
        </DataTable>
      </Panel>

      <Panel title={a.revenueTitle}>
        <p className="mb-3 text-sm text-navy-700">{a.receivedLabel}: {money(state.revenue.receivedByCurrency)} · {a.pendingLabel}: {money(state.revenue.pendingByCurrency)}</p>
        <p className="text-xs text-navy-500">{a.revenueNote}</p>
      </Panel>

      <Panel title={a.costTitle}>
        {state.cost.providers.length === 0 ? <p className="text-sm text-navy-600">{a.none}</p> : (
          <DataTable head={[a.provider, a.requests, a.tokensIn, a.tokensOut, a.cost]}>
            {state.cost.providers.map((p) => (
              <tr key={p.providerId} className="hover:bg-navy-50/50">
                <td className="px-4 py-3 font-mono text-xs text-navy-800" dir="ltr">{p.providerId}</td>
                <td className="px-4 py-3 text-sm text-navy-800">{p.requests}</td>
                <td className="px-4 py-3 text-sm text-navy-800">{p.tokensIn}</td>
                <td className="px-4 py-3 text-sm text-navy-800">{p.tokensOut}</td>
                <td className="px-4 py-3 text-sm text-navy-800">{p.cost === null ? a.noPrice : p.cost}</td>
              </tr>
            ))}
          </DataTable>
        )}
        <p className="mt-3 text-xs text-navy-500">{a.costNote}</p>
      </Panel>

      <p className="text-xs text-navy-500">{a.sample}: {state.sample.approvals} {a.approvalsCount} · {state.sample.artifacts} {a.contentCount} · {state.sample.runs} {a.runsCount} · {state.sample.applications} {a.leadsCount} · {state.sample.payments} {a.paymentsCount}</p>
    </>
  );
}
