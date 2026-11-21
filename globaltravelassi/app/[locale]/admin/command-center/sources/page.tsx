import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, formatDateTime, type Locale } from "@/lib/i18n";
import { formMessages } from "@/lib/validation/messages";
import { loadSources } from "@/lib/ai/sources/load";
import { SOURCE_CATEGORIES, JURISDICTIONS } from "@/lib/ai/sources/rules";
import { addSourceAction, changeSourceAction } from "@/lib/actions/sources";
import { ActionForm } from "@/components/forms/ActionForm";
import { SelectField, TextField } from "@/components/forms/Fields";
import { DataTable, Panel } from "@/components/admin/AdminUI";
import { LoadState } from "@/components/admin/command-center/Parts";
import { Badge } from "@/components/ui";

export const metadata: Metadata = { title: "Sources", robots: { index: false, follow: false } };

/** What the owner can do to a host, by its status. A retired host can only ask to come back. */
const INTENTS_BY_STATUS = {
  active: ["edit", "disable", "revalidate", "retire"],
  disabled: ["edit", "enable", "retire"],
  retired: ["request_reactivation"],
} as const;

export default async function SourcesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const t = dict.commandCenter;
  const s = t.sourcesUi;
  const messages = { ...formMessages(dict), ...s.msg };

  const state = await loadSources();
  if (state.status === "unauthorized") return <p className="text-sm text-rose-800">{s.msg.unauthorized}</p>;
  if (state.status !== "ok") return <LoadState kind={state.status} dict={dict} />;

  const categoryOptions = SOURCE_CATEGORIES.map((c) => ({ value: c, label: s.categoryLabels[c] }));
  const jurisdictionOptions = JURISDICTIONS.map((j) => ({ value: j, label: s.jurisdictionLabels[j] }));
  const day = (iso: string | null) => (iso ? formatDateTime(iso, locale) : s.never);

  return (
    <>
      <p className="text-sm leading-relaxed text-navy-600">{s.hint}</p>
      <p className="rounded-2xl bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">{s.disclaimer}</p>

      <Panel title={s.addTitle}>
        <ActionForm action={addSourceAction} messages={messages} submitLabel={s.addSubmit} pendingLabel={dict.common.loading} submitVariant="navy" resetOnSuccess className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="locale" value={locale} />
          <TextField name="host" label={s.addHost} required ltr maxLength={255} />
          <SelectField name="category" label={s.category} required defaultValue="other" options={categoryOptions} />
          <SelectField name="jurisdiction" label={s.jurisdiction} required defaultValue="all" options={jurisdictionOptions} />
          <TextField name="purpose" label={s.addPurpose} required maxLength={200} />
          <TextField name="expiresAt" label={s.addExpiry} type="date" />
          <TextField name="reason" label={s.addReason} required maxLength={500} />
        </ActionForm>
      </Panel>

      <Panel title={s.listTitle}>
        {state.rows.length === 0 ? (
          <p className="text-sm text-navy-600">{s.noSources}</p>
        ) : (
          <div className="space-y-5">
            {state.rows.map((row) => (
              <article key={row.host} className="rounded-2xl border border-navy-100 bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p dir="ltr" className="font-mono text-sm font-semibold text-navy-900">{row.host}</p>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={row.status === "active" ? "success" : "neutral"}>{s.statusLabels[row.status]}</Badge>
                    <Badge tone={row.usable ? "success" : "danger"}>{s.usable}: {row.usable ? s.yes : s.no}</Badge>
                    {row.revalidationDue && <Badge tone="warning">{s.due}</Badge>}
                  </div>
                </div>
                <dl className="mt-3 grid gap-2 text-xs text-navy-700 sm:grid-cols-3">
                  <div><dt className="font-semibold">{s.category}</dt><dd>{s.categoryLabels[row.category]}</dd></div>
                  <div><dt className="font-semibold">{s.jurisdiction}</dt><dd>{s.jurisdictionLabels[row.jurisdiction]}</dd></div>
                  <div><dt className="font-semibold">{s.purpose}</dt><dd>{row.purpose}</dd></div>
                  <div><dt className="font-semibold">{s.expires}</dt><dd>{day(row.expiresAt)}</dd></div>
                  <div><dt className="font-semibold">{s.validated}</dt><dd>{day(row.validatedAt)}</dd></div>
                </dl>
                <ActionForm action={changeSourceAction} messages={messages} submitLabel={s.changeSubmit} pendingLabel={dict.common.loading} submitVariant="navy" resetOnSuccess className="mt-4 grid gap-4 sm:grid-cols-2">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="host" value={row.host} />
                  <input type="hidden" name="expectedVersion" value={row.version} />
                  <SelectField name="intent" label={s.intent.edit} required defaultValue={INTENTS_BY_STATUS[row.status][0]} options={INTENTS_BY_STATUS[row.status].map((i) => ({ value: i, label: s.intent[i] }))} />
                  <SelectField name="category" label={s.category} defaultValue={row.category} options={categoryOptions} />
                  <SelectField name="jurisdiction" label={s.jurisdiction} defaultValue={row.jurisdiction} options={jurisdictionOptions} />
                  <TextField name="purpose" label={s.purpose} defaultValue={row.purpose} maxLength={200} />
                  <TextField name="expiresAt" label={s.expires} type="date" />
                  <TextField name="reason" label={s.changeReason} required maxLength={500} />
                </ActionForm>
              </article>
            ))}
          </div>
        )}
      </Panel>

      <Panel title={t.navSources}>
        <DataTable head={[s.host, s.category, s.jurisdiction, s.status, s.validated]}>
          {state.rows.map((row) => (
            <tr key={row.host} className="hover:bg-navy-50/50">
              <td className="px-4 py-3 font-mono text-xs text-navy-800" dir="ltr">{row.host}</td>
              <td className="px-4 py-3">{s.categoryLabels[row.category]}</td>
              <td className="px-4 py-3">{s.jurisdictionLabels[row.jurisdiction]}</td>
              <td className="px-4 py-3">{s.statusLabels[row.status]}</td>
              <td className="px-4 py-3 whitespace-nowrap">{day(row.validatedAt)}</td>
            </tr>
          ))}
        </DataTable>
      </Panel>
    </>
  );
}
