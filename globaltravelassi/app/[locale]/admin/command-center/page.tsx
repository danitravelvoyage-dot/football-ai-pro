import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, type Locale } from "@/lib/i18n";
import { loadCommandCenter, RUN_LIMIT } from "@/lib/ai/command-center/load";
import { CORE_MODULES, rollupByDepartment, truncate } from "@/lib/ai/command-center/view";
import { loadProviderConfig } from "@/lib/ai/llm/config";
import { Alert } from "@/components/ui";
import { Panel, StatCard } from "@/components/admin/AdminUI";
import { Fact, LoadState } from "@/components/admin/command-center/Parts";

export const metadata: Metadata = { title: "AI command center", robots: { index: false, follow: false } };

export default async function CommandCenterOverview({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const t = dict.commandCenter;
  const base = `/${locale}/admin/command-center`;

  const state = await loadCommandCenter();
  if (state.status !== "ok") return <LoadState kind={state.status} dict={dict} />;

  const { report, tasks, runs, approvals, honestyProblems, runsTruncated } = state;
  const departments = rollupByDepartment(tasks);
  const providers = loadProviderConfig(process.env).map((p) => ({ id: p.id, kind: p.kind, enabled: p.enabled }));
  const liveProviderEnabled = providers.some((p) => p.kind !== "mock" && p.enabled);
  const runsLabel = runs.length >= RUN_LIMIT ? `${runs.length}+` : String(runs.length);
  const failedTasks = report.failed.slice(0, 10);
  const externalItems = report.externalItems;
  const decided = approvals.filter((a) => a.status !== "pending").length;

  return (
    <>
      <h2 className="font-display text-2xl font-semibold text-navy-900">{t.executiveTitle}</h2>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
        <StatCard label={t.kpiRuns} value={runsLabel} />
        <StatCard label={t.kpiPending} value={report.pendingApprovals} />
        <StatCard label={t.kpiRunning} value={report.counts.running} />
        <StatCard label={t.kpiFailed} value={report.counts.failed} />
        <StatCard label={t.kpiSucceeded} value={report.counts.succeeded} />
      </div>

      {runsTruncated && <Alert tone="warning">{t.runScopeNote}</Alert>}

      <div className="grid gap-8 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Panel title={t.dailyBrief}>
            <p className="mb-4 text-xs text-navy-500">{t.dailyBriefHint}</p>
            <ul className="space-y-3 text-sm leading-relaxed text-navy-800">
              {report.statements.map((line) => (
                <li key={line} className="flex gap-3">
                  <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold-500" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <p className={`mt-5 rounded-2xl px-4 py-3 text-sm ${honestyProblems.length === 0 ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900"}`}>
              <span className="font-semibold">{t.reportCheck}: </span>
              {honestyProblems.length === 0 ? t.reportCheckOk : t.reportCheckFail}
            </p>
          </Panel>
        </div>

        <div className="lg:col-span-2">
          <Panel
            title={t.externalWaiting}
            action={<Link href={`${base}/approvals`} className="text-sm font-semibold text-gold-600 hover:text-gold-500">{t.navApprovals} →</Link>}
          >
            <p className="mb-4 text-sm text-navy-600">{t.externalNote}</p>
            {externalItems.length === 0 ? (
              <p className="text-sm text-navy-500">{t.noData}</p>
            ) : (
              <ul className="space-y-3">
                {externalItems.map((item) => (
                  <li key={item.approvalId} className="rounded-2xl border border-navy-100 p-4">
                    <p className="font-mono text-xs text-navy-700" dir="ltr">{item.action}</p>
                    <p className="mt-1 text-sm font-semibold text-navy-900">{t.extStatus[item.status]}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <Panel
        title={t.failedTitle}
        action={<Link href={`${base}/tasks`} className="text-sm font-semibold text-gold-600 hover:text-gold-500">{t.navTasks} →</Link>}
      >
        {failedTasks.length === 0 ? (
          <p className="text-sm text-navy-600">{t.noFailures}</p>
        ) : (
          <ul className="divide-y divide-navy-100">
            {failedTasks.map((task) => (
              <li key={task.taskId} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                <div className="min-w-0">
                  <p className="font-semibold text-navy-900">{task.title}</p>
                  <p className="font-mono text-xs text-navy-500" dir="ltr">{task.agent}</p>
                </div>
                {task.error && <p className="text-sm text-rose-800 sm:max-w-md" dir="ltr">{truncate(task.error, 200)}</p>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={t.liveNetwork}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {departments.map(({ key, agents, rollup }) => (
            <div key={key} className="rounded-2xl border border-navy-100 bg-navy-50/40 p-5">
              <p className="font-semibold text-navy-900">{t.departments[key]}</p>
              <p className="mt-1 font-mono text-xs text-navy-500" dir="ltr">{agents.join(" · ")}</p>
              <dl className="mt-4 grid grid-cols-3 gap-3">
                <Fact label={t.runs} value={rollup.total} />
                <Fact label={t.activeNow} value={rollup.active} />
                <Fact label={t.failures} value={rollup.failed} />
              </dl>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title={t.systemHealth}>
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-3 text-sm text-navy-800">
            <p>{t.dbOk}</p>
            <p>{liveProviderEnabled ? t.providerLive : t.providerMock}</p>
            <p className="text-xs text-navy-500">{t.decidedHistory}: {decided}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-navy-500">{t.providers}</p>
            <ul className="mt-3 space-y-2 text-sm">
              {providers.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs text-navy-800" dir="ltr">{p.id}</span>
                  <span className={p.enabled ? "font-semibold text-emerald-800" : "text-navy-500"}>
                    {p.enabled ? t.providerEnabled : t.providerDisabled}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-navy-500">{t.modulesTitle}</p>
            <ul className="mt-3 space-y-2 text-xs">
              {CORE_MODULES.built.map((m) => (
                <li key={m} className="flex items-center justify-between gap-3">
                  <span className="font-mono text-navy-800" dir="ltr">{m}</span>
                  <span className="font-semibold text-emerald-800">{t.modulesBuilt}</span>
                </li>
              ))}
              {CORE_MODULES.notBuilt.map((m) => (
                <li key={m} className="flex items-center justify-between gap-3">
                  <span className="font-mono text-navy-800" dir="ltr">{m}</span>
                  <span className="font-semibold text-amber-800">{t.modulesNotBuilt}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Panel>

    </>
  );
}
