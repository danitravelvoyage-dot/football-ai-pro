import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, formatDateTime, type Locale } from "@/lib/i18n";
import { loadMemory } from "@/lib/ai/command-center/memory-load";
import { ownerId } from "@/lib/actions/ai";
import { createExperimentAction, recordResultAction, saveLearningSettingsAction, setExperimentStatusAction } from "@/lib/actions/memory";
import { ActionForm } from "@/components/forms/ActionForm";
import { SelectField, TextAreaField, TextField } from "@/components/forms/Fields";
import { formMessages } from "@/lib/validation/messages";
import { Badge } from "@/components/ui";
import { DataTable, Panel } from "@/components/admin/AdminUI";
import { LoadState } from "@/components/admin/command-center/Parts";
import { compareVariants, hypothesesFrom, repeatedPatterns } from "@/lib/ai/memory/learning";
import { EXPERIMENT_KINDS, METRICS, RESULT_SOURCES } from "@/lib/ai/memory/types";
import { percentOf } from "@/lib/ai/command-center/memory-view";
import { truncate } from "@/lib/ai/command-center/view";

export const metadata: Metadata = { title: "Experiments", robots: { index: false, follow: false } };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ExperimentsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Search }) {
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
  const state = await loadMemory({ kind: "owner", id: owner }, null);
  if (state.status !== "ok") return <LoadState kind={state.status} dict={dict} />;

  const selectedId = one(sp.id);
  const selected = selectedId && UUID.test(selectedId) ? state.experiments.find((e) => e.id === selectedId) ?? null : null;
  const resultsOf = (id: string) => state.results.filter((r) => r.experimentId === id);
  const selectedResults = selected ? resultsOf(selected.id) : [];
  const metricsPresent = [...new Set(selectedResults.map((r) => r.metric))];
  const statusLabel = (s: string) => m.statusLabels[s as keyof typeof m.statusLabels] ?? s;
  const { settings } = state;

  const hypotheses = METRICS.flatMap((metric) => hypothesesFrom(repeatedPatterns(state.experiments, state.results, metric, settings), state.results, metric, settings));

  return (
    <>
      <p className="text-sm leading-relaxed text-navy-600">{m.experimentsHint}</p>

      <Panel title={m.settingsTitle}>
        <p className="mb-4 text-sm text-navy-600">{m.settingsHint}</p>
        <ActionForm action={saveLearningSettingsAction} messages={messages} submitLabel={m.saveSettings} pendingLabel={dict.common.loading} submitVariant="navy" className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="locale" value={locale} />
          <TextField name="minSample" label={m.minSample} type="number" min="5" required defaultValue={String(settings.minSample)} />
          <TextField name="minLift" label={m.minLift} type="number" min="0.01" required defaultValue={String(settings.minLift)} />
        </ActionForm>
      </Panel>

      <Panel title={m.createTitle}>
        <ActionForm action={createExperimentAction} messages={messages} submitLabel={m.create} pendingLabel={dict.common.loading} submitVariant="navy" resetOnSuccess className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="locale" value={locale} />
          <SelectField name="kind" label={m.kind} required defaultValue="campaign" options={EXPERIMENT_KINDS.map((k) => ({ value: k, label: m.kinds[k] }))} />
          <TextField name="name" label={m.name} required maxLength={120} />
          <div className="sm:col-span-2">
            <TextAreaField name="hypothesis" label={m.hypothesis} required rows={2} maxLength={500} />
          </div>
        </ActionForm>
      </Panel>

      <Panel title={m.listTitle}>
        {state.experiments.length === 0 ? (
          <p className="text-sm text-navy-600">{m.noExperiments}</p>
        ) : (
          <DataTable head={[m.name, m.kind, t.status, m.decidedAt, t.details]}>
            {state.experiments.map((e) => (
              <tr key={e.id} className="align-top hover:bg-navy-50/50">
                <td className="px-4 py-3 font-semibold text-navy-900">{truncate(e.name, 80)}</td>
                <td className="px-4 py-3 text-sm">{m.kinds[e.kind]}</td>
                <td className="px-4 py-3"><Badge tone={e.status === "running" ? "info" : e.status === "finished" ? "success" : "neutral"}>{statusLabel(e.status)}</Badge></td>
                <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(e.createdAt, locale)}</td>
                <td className="px-4 py-3"><a className="font-semibold text-navy-700 underline-offset-4 hover:underline" href={`?id=${e.id}`}>{m.details}</a></td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      {selected && (
        <>
          <Panel title={selected.name}>
            <p className="text-sm leading-relaxed text-navy-800">{selected.hypothesis}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              {selected.status === "draft" && (
                <ActionForm action={setExperimentStatusAction} messages={messages} submitLabel={m.startRun} pendingLabel={dict.common.loading} submitVariant="navy" hideSubmit={false}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="id" value={selected.id} />
                  <input type="hidden" name="status" value="running" />
                </ActionForm>
              )}
              {selected.status === "running" && (
                <ActionForm action={setExperimentStatusAction} messages={messages} submitLabel={m.finishRun} pendingLabel={dict.common.loading} submitVariant="navy" confirmMessage={m.finishRun}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="id" value={selected.id} />
                  <input type="hidden" name="status" value="finished" />
                </ActionForm>
              )}
            </div>
          </Panel>

          <Panel title={m.recordResultTitle}>
            <ActionForm action={recordResultAction} messages={messages} submitLabel={m.recordResult} pendingLabel={dict.common.loading} submitVariant="navy" resetOnSuccess className="grid gap-4 sm:grid-cols-3">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="experimentId" value={selected.id} />
              <TextField name="variant" label={m.variant} required maxLength={60} />
              <SelectField name="metric" label={m.metric} required defaultValue="conversions" options={METRICS.map((v) => ({ value: v, label: m.metrics[v] }))} />
              <TextField name="value" label={m.value} type="number" min="0" required />
              <TextField name="sampleSize" label={m.sampleSize} type="number" min="1" required />
              <SelectField name="source" label={m.source} required defaultValue="manual" options={RESULT_SOURCES.map((v) => ({ value: v, label: m.sources[v] }))} />
              <TextField name="period" label={m.period} required maxLength={40} />
            </ActionForm>
          </Panel>

          <Panel title={m.resultsTitle}>
            {selectedResults.length === 0 ? (
              <p className="text-sm text-navy-600">{m.noResults}</p>
            ) : (
              <DataTable head={[m.variant, m.metric, m.value, m.sampleSize, m.source, m.period]}>
                {selectedResults.map((r) => (
                  <tr key={r.id} className="hover:bg-navy-50/50">
                    <td className="px-4 py-3 font-mono text-xs" dir="ltr">{r.variant}</td>
                    <td className="px-4 py-3">{m.metrics[r.metric as keyof typeof m.metrics]}</td>
                    <td className="px-4 py-3" dir="ltr">{r.value}</td>
                    <td className="px-4 py-3" dir="ltr">{r.sampleSize}</td>
                    <td className="px-4 py-3">{m.sources[r.source]}</td>
                    <td className="px-4 py-3" dir="ltr">{r.period}</td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Panel>

          <Panel title={m.comparisonTitle}>
            {metricsPresent.length === 0 ? (
              <p className="text-sm text-navy-600">{m.noResults}</p>
            ) : (
              <ul className="space-y-3">
                {metricsPresent.map((metric) => {
                  const cmp = compareVariants(selectedResults, metric, settings);
                  return (
                    <li key={metric} className="flex flex-wrap items-center gap-3">
                      <span className="text-sm font-semibold text-navy-900">{m.metrics[metric as keyof typeof m.metrics]}</span>
                      <Badge tone={cmp.verdict === "winner" ? "success" : "neutral"}>{m.verdicts[cmp.verdict]}</Badge>
                      {cmp.verdict === "winner" && (
                        <span className="text-sm text-navy-700">{m.verdictWinner.replace("{winner}", cmp.winner).replace("{loser}", cmp.loser).replace("{lift}", String(percentOf(cmp.lift)))}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </>
      )}

      <Panel title={m.recommendationsTitle}>
        {hypotheses.length === 0 ? (
          <p className="text-sm text-navy-600">{m.noRecommendations}</p>
        ) : (
          <ul className="space-y-4">
            {hypotheses.map((h, i) => (
              <li key={i} className="rounded-2xl border border-navy-100 bg-navy-50/40 p-4">
                <p className="text-sm leading-relaxed text-navy-900">{h.statement}</p>
                <p className="mt-2 text-xs text-navy-500">{m.evidence}: {h.evidence.length} · {new Set(h.evidence.map((e) => e.experimentId)).size} {m.listTitle}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
