import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, formatDateTime, type Locale } from "@/lib/i18n";
import { loadMonitor } from "@/lib/ai/observability/load";
import { DataTable, Panel } from "@/components/admin/AdminUI";
import { Fact, LoadState } from "@/components/admin/command-center/Parts";
import { Badge } from "@/components/ui";

export const metadata: Metadata = { title: "Monitoring", robots: { index: false, follow: false } };

export default async function MonitorPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const t = dict.commandCenter;
  const m = t.monitor;

  const state = await loadMonitor();
  if (state.status !== "ok") return <LoadState kind={state.status} dict={dict} />;

  const pct = (v: number | null) => (v === null ? m.unavailable : `${Math.round(v * 100)}%`);
  const num = (v: number | null, suffix = "") => (v === null ? m.unavailable : `${v}${suffix}`);
  const toneFor = (s: string) => (s === "working" ? "info" : s === "stalled" ? "warning" : s === "failing" ? "danger" : "neutral") as "info" | "warning" | "danger" | "neutral";

  return (
    <>
      <p className="text-sm leading-relaxed text-navy-600">{m.hint}</p>
      <p className="text-xs text-navy-500">
        {m.sample}: {state.sampleSizes.tasks} {t.tasksTitle} · {state.sampleSizes.runs} {t.runs} · {state.sampleSizes.reviews} {m.qualityScore}
      </p>

      <Panel title={m.alerts}>
        {state.alerts.length === 0 ? (
          <p className="text-sm text-navy-600">{m.noAlerts}</p>
        ) : (
          <ul className="space-y-3">
            {state.alerts.map((a) => (
              <li key={`${a.kind}-${a.subject}`} className="flex flex-wrap items-center gap-3">
                <Badge tone="danger">{a.kind === "repeated_agent_failures" ? m.alertRepeated : m.alertStalled}</Badge>
                <span className="font-mono text-xs text-navy-700" dir="ltr">{a.subject}</span>
                <span className="text-sm text-navy-800">{a.count}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={m.board}>
        {state.board.length === 0 ? (
          <p className="text-sm text-navy-600">{t.noData}</p>
        ) : (
          <DataTable head={[m.agent, m.live, m.active, m.completed, m.failed, m.retries, m.lastActivity, m.duration, m.failureRate, m.workload]}>
            {state.board.map((r) => (
              <tr key={r.agent} className="align-top hover:bg-navy-50/50">
                <td className="px-4 py-3 font-mono text-xs text-navy-800" dir="ltr">{r.agent}</td>
                <td className="px-4 py-3"><Badge tone={toneFor(r.liveStatus)}>{m.liveLabels[r.liveStatus]}</Badge></td>
                <td className="px-4 py-3">{r.active}</td>
                <td className="px-4 py-3">{r.completed}</td>
                <td className="px-4 py-3">{r.failed}</td>
                <td className="px-4 py-3">{r.retries}</td>
                <td className="px-4 py-3 whitespace-nowrap">{r.lastActivity ? formatDateTime(r.lastActivity, locale) : m.unavailable}</td>
                <td className="px-4 py-3 whitespace-nowrap" dir="ltr">{r.averageDurationMs === null ? m.unavailable : `${r.averageDurationMs} ms`}</td>
                <td className="px-4 py-3">{pct(r.failureRate)}</td>
                <td className="px-4 py-3">{pct(r.workloadShare)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <Panel title={m.performance}>
        <dl className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <Fact label={m.completed} value={state.performance.tasksCompleted} />
          <Fact label={m.failed} value={state.performance.tasksFailed} />
          <Fact label={m.successRate} value={pct(state.performance.successRate)} />
          <Fact label={m.duration} value={num(state.performance.averageExecutionMs, " ms")} />
          <Fact label={m.revisionRate} value={pct(state.performance.revisionRate)} />
          <Fact label={m.qualityScore} value={num(state.performance.outputQualityScore)} />
        </dl>
      </Panel>

      <Panel title={m.usage}>
        <p className="mb-4 text-sm text-navy-600">{m.costUnavailable}</p>
        <dl className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
          <Fact label={m.tokensIn} value={state.usage.tokensIn} />
          <Fact label={m.tokensOut} value={state.usage.tokensOut} />
          <Fact label={m.estimatedCost} value={m.unavailable} />
        </dl>
        {state.usage.providers.length === 0 ? (
          <p className="text-sm text-navy-600">{t.noData}</p>
        ) : (
          <DataTable head={[m.provider, m.requests, m.tokens]}>
            {state.usage.providers.map((p) => (
              <tr key={p.providerId} className="hover:bg-navy-50/50">
                <td className="px-4 py-3 font-mono text-xs" dir="ltr">{p.providerId}</td>
                <td className="px-4 py-3">{p.requests}</td>
                <td className="px-4 py-3">{p.tokens}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <Panel title={m.health}>
        <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Fact label={m.pending} value={state.health.eventBus.pending} />
          <Fact label={m.delivered} value={state.health.eventBus.delivered} />
          <Fact label={m.deadLetters} value={state.health.deadLetterQueue} />
          <Fact label={m.errorRate} value={pct(state.health.agentErrorRate)} />
          <Fact label={m.database} value={state.health.database.ok ? m.dbOk : m.unavailable} />
          <Fact label={m.latency} value={num(state.health.database.latencyMs, " ms")} />
          <Fact label={m.withFailures} value={`${state.health.workflows.withFailures} / ${state.health.workflows.total}`} />
          <Fact label={m.scheduler} value={m.schedulerNotBuilt} />
        </dl>
        <p className="mt-4 text-xs text-navy-500">{formatDateTime(state.generatedAt, locale)}</p>
      </Panel>
    </>
  );
}
