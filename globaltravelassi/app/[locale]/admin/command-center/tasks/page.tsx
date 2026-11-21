import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, formatDateTime, type Locale } from "@/lib/i18n";
import { loadCommandCenter } from "@/lib/ai/command-center/load";
import { groupTasksByRun, progressOf, sortTasks, truncate } from "@/lib/ai/command-center/view";
import { AGENT_REGISTRY } from "@/lib/ai/registry";
import { retryTaskAction } from "@/lib/actions/ai";
import { ActionForm } from "@/components/forms/ActionForm";
import { formMessages } from "@/lib/validation/messages";
import { DataTable, Panel } from "@/components/admin/AdminUI";
import { LoadState, TaskBadge } from "@/components/admin/command-center/Parts";

export const metadata: Metadata = { title: "Task orchestration", robots: { index: false, follow: false } };

export default async function TasksPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const t = dict.commandCenter;
  const messages = formMessages(dict);

  const state = await loadCommandCenter();
  if (state.status !== "ok") return <LoadState kind={state.status} dict={dict} />;
  const { tasks, runs } = state;
  const byRun = groupTasksByRun(tasks);
  const titleById = new Map(tasks.map((task) => [task.id, task.title]));
  const queue = sortTasks(tasks);

  return (
    <>
      <Panel title={t.workflowView}>
        {runs.length === 0 ? (
          <p className="text-sm text-navy-600">{t.noRuns}</p>
        ) : (
          <div className="space-y-8">
            {runs.slice(0, 10).map((run) => {
              const steps = byRun.get(run.id) ?? [];
              const p = progressOf(steps);
              return (
                <div key={run.id}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-semibold text-navy-900">{run.objective}</p>
                    <p className="text-sm font-semibold text-navy-700">{p.done} / {p.total} {t.stepsDone}</p>
                  </div>
                  <ol className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {steps.map((step, index) => (
                      <li key={step.id} className="flex gap-3 rounded-2xl border border-navy-100 bg-navy-50/40 p-4">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy-900 text-xs font-semibold text-white">{index + 1}</span>
                        <div className="min-w-0 space-y-2">
                          <p className="text-sm font-semibold text-navy-900">{step.title}</p>
                          <p className="font-mono text-xs text-navy-500" dir="ltr">{step.agent}</p>
                          <TaskBadge status={step.status} dict={dict} />
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel title={t.tasksTitle}>
        {queue.length === 0 ? (
          <p className="text-sm text-navy-600">{t.noData}</p>
        ) : (
          <DataTable head={[t.task, t.agent, t.status, t.attempts, t.depends, t.error, t.retry]}>
            {queue.map((task) => {
              const dependencies = task.dependsOn.map((id) => titleById.get(id) ?? "—");
              return (
                <tr key={task.id} className="align-top hover:bg-navy-50/50">
                  <td className="px-4 py-3 font-semibold text-navy-900">{task.title}</td>
                  <td className="px-4 py-3 font-mono text-xs text-navy-700" dir="ltr">{AGENT_REGISTRY[task.agent]?.name ?? task.agent}</td>
                  <td className="px-4 py-3"><TaskBadge status={task.status} dict={dict} /></td>
                  <td className="px-4 py-3 whitespace-nowrap">{task.attempts} / {task.maxAttempts}</td>
                  <td className="px-4 py-3 text-xs text-navy-600">{dependencies.length > 0 ? dependencies.join(" · ") : "—"}</td>
                  <td className="px-4 py-3 text-xs text-rose-800" dir="ltr">{task.lastError ? truncate(task.lastError, 160) : "—"}</td>
                  <td className="px-4 py-3">
                    {task.status === "failed" ? (
                      <ActionForm action={retryTaskAction} messages={messages} submitLabel={t.retry} pendingLabel={dict.common.loading} submitVariant="navy">
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="taskId" value={task.id} />
                      </ActionForm>
                    ) : (
                      <span className="text-navy-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Panel>

      <Panel title={t.traceTitle}>
        <p className="mb-4 text-sm leading-relaxed text-navy-600">{t.traceHint}</p>
        {state.traces.length === 0 ? <p className="text-sm text-navy-600">{t.traceNoRuns}</p> : null}
        {state.traces.map((trace) => (
          <div key={trace.runId} className="mb-8 last:mb-0">
            <h3 className="mb-2 font-mono text-xs text-navy-700" dir="ltr">{trace.runId}</h3>
            <DataTable head={[t.traceStep, t.traceAgent, t.traceStatus, t.traceAttempts, t.traceDepends, t.traceReview]}>
              {trace.steps.map((step) => (
                <tr key={step.taskId} className="align-top hover:bg-navy-50/50">
                  <td className="px-4 py-3 font-mono text-xs text-navy-800" dir="ltr">{step.stepKey}</td>
                  <td className="px-4 py-3 text-sm text-navy-800" dir="ltr">{step.agent}</td>
                  <td className="px-4 py-3"><TaskBadge status={step.status} dict={dict} /></td>
                  <td className="px-4 py-3 text-sm text-navy-800">{step.attempts}/{step.maxAttempts}</td>
                  <td className="px-4 py-3 text-xs text-navy-700" dir="ltr">{step.dependsOn.map((d) => titleById.get(d) ?? d.slice(0, 8)).join(", ") || "—"}</td>
                  <td className="px-4 py-3 text-sm text-navy-800">{step.quality.latestStatus ?? "—"}</td>
                </tr>
              ))}
            </DataTable>
            <p className="mt-3 text-sm font-semibold text-navy-900">{t.traceHandoffs}</p>
            {trace.handoffs.length === 0 ? (
              <p className="text-sm text-navy-600">{t.traceNoHandoffs}</p>
            ) : (
              <ul className="mt-1 space-y-1 text-sm text-navy-800">
                {trace.handoffs.map((h) => (
                  <li key={`${h.taskId}-${h.toAgent}`} dir="ltr">{h.fromAgent} → {h.toAgent} · {formatDateTime(h.at, locale)}</li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-sm font-semibold text-navy-900">{t.traceConflicts}</p>
            {trace.conflicts.length === 0 ? (
              <p className="text-sm text-navy-600">{t.traceNoConflicts}</p>
            ) : (
              <ul className="mt-1 space-y-1 text-sm text-navy-800">
                {trace.conflicts.map((c, i) => (
                  <li key={`${c.taskId}-${i}`} dir="ltr">{c.agent} · {c.codes.join(", ")}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </Panel>
    </>
  );
}
