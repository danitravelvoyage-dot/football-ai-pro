import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, formatDateTime, type Locale } from "@/lib/i18n";
import { loadMemory } from "@/lib/ai/command-center/memory-load";
import { parseSubject, parseVersion } from "@/lib/ai/command-center/memory-view";
import { truncate } from "@/lib/ai/command-center/view";
import { ownerId } from "@/lib/actions/ai";
import { recordDecisionAction } from "@/lib/actions/memory";
import { ActionForm } from "@/components/forms/ActionForm";
import { SelectField, TextAreaField, TextField } from "@/components/forms/Fields";
import { formMessages } from "@/lib/validation/messages";
import { Badge } from "@/components/ui";
import { DataTable, Panel } from "@/components/admin/AdminUI";
import { LoadState } from "@/components/admin/command-center/Parts";
import { DECISIONS, SUBJECT_TYPES } from "@/lib/ai/memory/types";

export const metadata: Metadata = { title: "Decisions", robots: { index: false, follow: false } };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function MemoryPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Search }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const t = dict.commandCenter;
  const m = t.memoryUi;
  const sp = await searchParams;
  const messages = { ...formMessages(dict), saved: m.saved, forbidden: m.errorForbidden, invalid_input: m.errorInvalid, version_conflict: m.errorConflict, unauthorized: m.errorUnauthorized, generic: m.errorGeneric };

  const owner = await ownerId();
  if (!owner) return <p className="text-sm text-rose-800">{m.unauthorized}</p>;

  const subject = parseSubject(one(sp.subject));
  const a = parseVersion(one(sp.a));
  const b = parseVersion(one(sp.b));
  const state = await loadMemory({ kind: "owner", id: owner }, subject);
  if (state.status !== "ok") return <LoadState kind={state.status} dict={dict} />;

  const label = (type: string) => m.subjectTypes[type as keyof typeof m.subjectTypes] ?? type;
  const decisionOf = (d: string) => m.decisionLabels[d as keyof typeof m.decisionLabels] ?? d;
  const approved = state.decisions.filter((d) => d.subjectType === "strategy" && d.decision === "approved");
  const rejected = state.decisions.filter((d) => d.subjectType === "strategy" && d.decision === "rejected");
  const versionA = a !== null ? state.history.find((h) => h.version === a) : undefined;
  const versionB = b !== null ? state.history.find((h) => h.version === b) : undefined;

  return (
    <>
      <p className="text-sm leading-relaxed text-navy-600">{m.decisionsHint}</p>

      <Panel title={m.recordDecision}>
        <ActionForm action={recordDecisionAction} messages={messages} submitLabel={m.save} pendingLabel={dict.common.loading} submitVariant="navy" resetOnSuccess className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="locale" value={locale} />
          <SelectField name="subjectType" label={m.subjectType} required defaultValue="strategy" options={SUBJECT_TYPES.map((v) => ({ value: v, label: label(v) }))} />
          <TextField name="subjectRef" label={m.subjectRef} required maxLength={120} ltr />
          <SelectField name="decision" label={m.decision} required defaultValue="approved" options={DECISIONS.map((v) => ({ value: v, label: decisionOf(v) }))} />
          <div className="sm:col-span-2">
            <TextAreaField name="reasoning" label={m.reasoning} required rows={3} maxLength={1000} />
          </div>
        </ActionForm>
      </Panel>

      <Panel title={m.latest}>
        {state.decisions.length === 0 ? (
          <p className="text-sm text-navy-600">{m.noDecisions}</p>
        ) : (
          <DataTable head={[m.subjectType, m.subjectRef, m.decision, m.version, m.decidedAt, m.reasoning]}>
            {state.decisions.map((d) => (
              <tr key={d.id} className="align-top hover:bg-navy-50/50">
                <td className="px-4 py-3 text-sm text-navy-800">{label(d.subjectType)}</td>
                <td className="px-4 py-3">
                  <a className="font-mono text-xs font-semibold text-navy-900 underline-offset-4 hover:underline" dir="ltr" href={`?subject=${d.subjectType}:${encodeURIComponent(d.subjectRef)}`}>
                    {truncate(d.subjectRef, 60)}
                  </a>
                </td>
                <td className="px-4 py-3"><Badge tone={d.decision === "rejected" ? "danger" : d.decision === "approved" ? "success" : "warning"}>{decisionOf(d.decision)}</Badge></td>
                <td className="px-4 py-3">{d.version}</td>
                <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(d.decidedAt, locale)}</td>
                <td className="px-4 py-3 text-xs text-navy-700">{truncate(d.reasoning, 140)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <div className="grid gap-8 lg:grid-cols-2">
        <Panel title={m.approved}>
          {approved.length === 0 ? <p className="text-sm text-navy-600">{m.noStrategies}</p> : (
            <ul className="space-y-2 text-sm text-navy-800">{approved.map((d) => <li key={d.id} dir="ltr" className="font-mono text-xs">{truncate(d.subjectRef, 80)}</li>)}</ul>
          )}
        </Panel>
        <Panel title={m.rejected}>
          {rejected.length === 0 ? <p className="text-sm text-navy-600">{m.noStrategies}</p> : (
            <ul className="space-y-2 text-sm text-navy-800">{rejected.map((d) => <li key={d.id} dir="ltr" className="font-mono text-xs">{truncate(d.subjectRef, 80)}</li>)}</ul>
          )}
        </Panel>
      </div>

      <Panel title={m.outdatedTitle}>
        <p className="mb-4 text-sm text-navy-600">{m.outdatedHint}</p>
        {state.outdated.length === 0 ? <p className="text-sm text-navy-600">{m.noStrategies}</p> : (
          <ul className="space-y-2 text-sm text-navy-800">{state.outdated.map((d) => <li key={d.id} dir="ltr" className="font-mono text-xs">{truncate(d.subjectRef, 80)} · {formatDateTime(d.decidedAt, locale)}</li>)}</ul>
        )}
      </Panel>

      <Panel title={m.historyTitle}>
        {!subject ? (
          <p className="text-sm text-navy-600">{m.noHistory}</p>
        ) : state.history.length === 0 ? (
          <p className="text-sm text-navy-600">{m.noDecisions}</p>
        ) : (
          <>
            <DataTable head={[m.version, m.decision, m.decidedAt, m.reasoning]}>
              {state.history.map((h) => (
                <tr key={h.id} className="align-top hover:bg-navy-50/50">
                  <td className="px-4 py-3">{h.version}</td>
                  <td className="px-4 py-3">{decisionOf(h.decision)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(h.decidedAt, locale)}</td>
                  <td className="px-4 py-3 text-xs text-navy-700">{truncate(h.reasoning, 200)}</td>
                </tr>
              ))}
            </DataTable>

            <form method="get" className="mt-6 grid gap-4 sm:grid-cols-3">
              <input type="hidden" name="subject" value={`${subject.type}:${subject.ref}`} />
              <TextField name="a" label={`${m.compareA} A`} type="number" min="1" defaultValue={a !== null ? String(a) : ""} />
              <TextField name="b" label={`${m.compareB} B`} type="number" min="1" defaultValue={b !== null ? String(b) : ""} />
              <div className="flex items-end">
                <button type="submit" className="rounded-full bg-navy-900 px-5 py-2 text-sm font-semibold text-white">{m.compareShow}</button>
              </div>
            </form>
            {(versionA || versionB) && (
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {[versionA, versionB].map((v, i) => (
                  <article key={i} className="rounded-2xl border border-navy-100 bg-navy-50/40 p-4">
                    {v ? (
                      <>
                        <p className="text-xs font-semibold uppercase tracking-wider text-navy-500">{m.version} {v.version}</p>
                        <p className="mt-2 font-semibold text-navy-900">{decisionOf(v.decision)}</p>
                        <p className="mt-1 text-xs text-navy-500">{formatDateTime(v.decidedAt, locale)}</p>
                        <p className="mt-3 text-sm text-navy-800">{v.reasoning}</p>
                      </>
                    ) : (
                      <p className="text-sm text-navy-600">{m.noHistory}</p>
                    )}
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </Panel>
    </>
  );
}
