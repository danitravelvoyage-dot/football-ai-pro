import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, formatDateTime, countryName, type Locale } from "@/lib/i18n";
import { loadCommandCenter } from "@/lib/ai/command-center/load";
import { groupTasksByRun, progressOf } from "@/lib/ai/command-center/view";
import { WORKFLOW_TEMPLATES, type WorkflowKey } from "@/lib/ai/workflows/templates";
import { COUNTRIES, LANGUAGES } from "@/lib/ai/types";
import { startWorkflowAction, tickAction } from "@/lib/actions/ai";
import { ActionForm } from "@/components/forms/ActionForm";
import { SelectField, TextAreaField, TextField } from "@/components/forms/Fields";
import { formMessages } from "@/lib/validation/messages";
import { DataTable, Panel } from "@/components/admin/AdminUI";
import { LoadState } from "@/components/admin/command-center/Parts";

export const metadata: Metadata = { title: "AI COO", robots: { index: false, follow: false } };

const LANGUAGE_NAMES: Record<(typeof LANGUAGES)[number], string> = { ar: "العربية", fr: "Français", en: "English" };

export default async function CooPage({ params }: { params: Promise<{ locale: string }> }) {
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
  const workflowNames = t.workflows as Record<string, string>;

  const workflowOptions = (Object.keys(WORKFLOW_TEMPLATES) as WorkflowKey[]).map((key) => ({ value: key, label: workflowNames[key] ?? key }));
  const languageOptions = LANGUAGES.map((code) => ({ value: code, label: LANGUAGE_NAMES[code] }));
  const countryOptions = COUNTRIES.map((code) => ({ value: code, label: countryName(code, locale) }));

  return (
    <>
      <div className="grid gap-8 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Panel title={t.startTitle}>
            <p className="mb-6 text-sm leading-relaxed text-navy-600">{t.startHint}</p>
            <ActionForm
              action={startWorkflowAction}
              messages={messages}
              submitLabel={t.submit}
              pendingLabel={t.pending}
              resetOnSuccess
              className="grid gap-5 sm:grid-cols-2"
            >
              <input type="hidden" name="locale" value={locale} />
              <div className="sm:col-span-2">
                <SelectField name="workflowKey" label={t.workflow} required options={workflowOptions} defaultValue="marketing" />
              </div>
              <div className="sm:col-span-2">
                <TextField name="objective" label={t.objective} required maxLength={2000} />
              </div>
              <SelectField name="language" label={t.language} required options={languageOptions} defaultValue="fr" />
              <SelectField name="country" label={t.country} required options={countryOptions} defaultValue="dz" />
              <div className="sm:col-span-2">
                <TextAreaField name="brief" label={t.brief} rows={4} maxLength={4000} />
              </div>
            </ActionForm>
          </Panel>
        </div>

        <div className="lg:col-span-2">
          <Panel title={t.tick}>
            <p className="mb-6 text-sm leading-relaxed text-navy-600">{t.approvalsHint}</p>
            <ActionForm action={tickAction} messages={messages} submitLabel={t.tick} pendingLabel={dict.common.loading} submitVariant="navy">
              <input type="hidden" name="locale" value={locale} />
            </ActionForm>
          </Panel>
        </div>
      </div>

      <Panel title={t.recentRuns}>
        {runs.length === 0 ? (
          <p className="text-sm text-navy-600">{t.noRuns}</p>
        ) : (
          <DataTable head={[t.objective, t.workflow, t.when, t.stepsDone]}>
            {runs.slice(0, 10).map((run) => {
              const p = progressOf(byRun.get(run.id) ?? []);
              return (
                <tr key={run.id} className="hover:bg-navy-50/50">
                  <td className="px-4 py-3 align-top">{run.objective}</td>
                  <td className="px-4 py-3 align-top">{workflowNames[run.workflowKey] ?? run.workflowKey}</td>
                  <td className="px-4 py-3 align-top whitespace-nowrap">{formatDateTime(run.createdAt, locale)}</td>
                  <td className="px-4 py-3 align-top whitespace-nowrap font-semibold text-navy-900">{p.done} / {p.total}</td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Panel>
    </>
  );
}
