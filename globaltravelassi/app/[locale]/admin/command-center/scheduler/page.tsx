import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, formatDateTime, type Locale } from "@/lib/i18n";
import { formMessages } from "@/lib/validation/messages";
import { ownerId } from "@/lib/actions/ai";
import { saveSchedulerSettingsAction } from "@/lib/actions/scheduler";
import { loadScheduler } from "@/lib/ai/scheduler/load";
import { formatInZone } from "@/lib/ai/scheduler/schedule";
import { ActionForm } from "@/components/forms/ActionForm";
import { CheckboxField, TextField } from "@/components/forms/Fields";
import { DataTable, Panel } from "@/components/admin/AdminUI";
import { Fact, LoadState } from "@/components/admin/command-center/Parts";
import { Badge } from "@/components/ui";

export const metadata: Metadata = { title: "Scheduler", robots: { index: false, follow: false } };

const STATUS_TONE = {
  healthy: "success",
  overdue: "warning",
  no_recent_worker: "danger",
  disabled: "neutral",
} as const;

const JOB_TONE = {
  queued: "info",
  running: "info",
  succeeded: "success",
  failed: "warning",
  dead: "danger",
} as const;

export default async function SchedulerPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const s = dict.commandCenter.schedulerUi;

  const messages = {
    ...formMessages(dict),
    saved: s.saved,
    forbidden: s.errorForbidden,
    invalid_input: s.errorInvalid,
    unauthorized: s.errorUnauthorized,
    generic: s.errorGeneric,
  };

  const owner = await ownerId();
  if (!owner) return <p className="text-sm text-rose-800">{s.errorUnauthorized}</p>;

  const view = await loadScheduler();
  if (view.status !== "ok") return <LoadState kind={view.status} dict={dict} />;
  const { health: h, jobs } = view;

  const when = (iso: string | null) => (iso ? `${formatInZone(iso, h.timezone)} (${h.timezone})` : s.never);
  const deadEvents = h.deadEventDeliveries === null ? s.unavailable : String(h.deadEventDeliveries);

  return (
    <>
      <p className="text-sm leading-relaxed text-navy-600">{s.hint}</p>

      <Panel title={s.healthTitle}>
        <div className="mb-4">
          <Badge tone={STATUS_TONE[h.status]}>{s.statusLabels[h.status]}</Badge>
        </div>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label={s.queued} value={h.queued} />
          <Fact label={s.overdue} value={h.overdue} />
          <Fact label={s.deadJobs} value={h.counts.dead} />
          <Fact label={s.deadEvents} value={deadEvents} />
          <Fact label={s.lastSeen} value={when(h.lastSeenAt)} />
          <Fact label={s.interval} value={h.intervalMinutes} />
        </dl>
      </Panel>

      <Panel title={s.settingsTitle}>
        <p className="mb-4 text-sm leading-relaxed text-navy-600">{s.settingsHint}</p>
        <ActionForm action={saveSchedulerSettingsAction} messages={messages} submitLabel={s.save} pendingLabel={dict.common.loading} submitVariant="navy" className="grid gap-4 sm:grid-cols-2">
          <CheckboxField name="enabled" label={s.enabled} defaultChecked={h.enabled} />
          <span />
          <TextField name="intervalMinutes" label={s.interval} type="number" min="1" required defaultValue={String(h.intervalMinutes)} />
          <TextField name="leaseSeconds" label={s.leaseSeconds} type="number" min="60" required defaultValue={String(h.leaseSeconds)} />
          <p className="text-xs text-navy-500 sm:col-span-2">{s.intervalHint} {s.leaseHint}</p>
          <TextField name="maxAttempts" label={s.maxAttempts} type="number" min="1" required defaultValue={String(h.maxAttempts)} />
          <TextField name="timezone" label={s.timezone} ltr required maxLength={64} defaultValue={h.timezone} />
          <p className="text-xs text-navy-500 sm:col-span-2">{s.maxAttemptsHint} {s.timezoneHint}</p>
        </ActionForm>
      </Panel>

      <Panel title={s.triggerTitle}>
        <p className="mb-3 text-sm leading-relaxed text-navy-600">{s.triggerHint}</p>
        <p className="font-mono text-sm text-navy-800" dir="ltr">POST {s.triggerPath}</p>
      </Panel>

      <Panel title={s.workersTitle}>
        {h.workers.length === 0 ? (
          <p className="text-sm text-navy-600">{s.noWorkers}</p>
        ) : (
          <DataTable head={[s.worker, s.lastSeen, s.outcome]}>
            {h.workers.map((w) => (
              <tr key={w.workerId} className="align-top hover:bg-navy-50/50">
                <td className="px-4 py-3 font-mono text-xs text-navy-800" dir="ltr">{w.workerId}</td>
                <td className="px-4 py-3 text-sm text-navy-800">{formatDateTime(w.lastSeenAt, locale)}</td>
                <td className="px-4 py-3 font-mono text-xs text-navy-700" dir="ltr">{w.lastOutcome ?? s.unavailable}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <Panel title={s.jobsTitle}>
        {jobs.length === 0 ? (
          <p className="text-sm text-navy-600">{s.noJobs}</p>
        ) : (
          <DataTable head={[s.slot, s.status, s.attempts, s.lastError, s.updated]}>
            {jobs.map((j) => (
              <tr key={j.id} className="align-top hover:bg-navy-50/50">
                <td className="px-4 py-3 text-sm text-navy-800">{formatInZone(j.runAt, h.timezone)}</td>
                <td className="px-4 py-3"><Badge tone={JOB_TONE[j.status]}>{s.jobStatus[j.status]}</Badge></td>
                <td className="px-4 py-3 text-sm text-navy-800">{j.attempts} / {j.maxAttempts}</td>
                <td className="max-w-xs px-4 py-3 text-xs text-navy-700">{j.lastError ?? "—"}</td>
                <td className="px-4 py-3 text-sm text-navy-800">{formatDateTime(j.updatedAt, locale)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
    </>
  );
}
