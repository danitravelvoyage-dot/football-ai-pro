import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, formatDateTime, type Locale } from "@/lib/i18n";
import { formMessages } from "@/lib/validation/messages";
import { freshnessOf, KB_CATEGORIES, RELIABILITY_STATUSES, type KbEntry } from "@/lib/ai/knowledge/rules";
import { loadKnowledgeAdmin } from "@/lib/ai/knowledge/load";
import { saveKnowledgeAction, retireKnowledgeAction } from "@/lib/actions/knowledge";
import { freshnessTone, safeHttpsUrl, truncate } from "@/lib/ai/command-center/view";
import { COUNTRIES, LANGUAGES } from "@/lib/ai/types";
import { ActionForm } from "@/components/forms/ActionForm";
import { SelectField, TextAreaField, TextField } from "@/components/forms/Fields";
import { Badge } from "@/components/ui";
import { DataTable, Panel } from "@/components/admin/AdminUI";
import { LoadState } from "@/components/admin/command-center/Parts";

export const metadata: Metadata = { title: "Knowledge base", robots: { index: false, follow: false } };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function KnowledgePage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Search }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const t = dict.commandCenter;
  const k = t.kbUi;
  const sp = await searchParams;

  const category = KB_CATEGORIES.find((c) => c === one(sp.category));
  const country = COUNTRIES.find((c) => c === one(sp.country));
  const language = LANGUAGES.find((l) => l === one(sp.language));
  const state = await loadKnowledgeAdmin({ text: one(sp.q) ?? "", category, country, language, tag: one(sp.tag) }, one(sp.id));
  if (state.status === "unauthorized") return <p className="text-sm text-rose-800">{k.unauthorized}</p>;
  if (state.status !== "ok") return <LoadState kind={state.status} dict={dict} />;

  const messages = { ...formMessages(dict), saved: k.saved, forbidden: k.errorForbidden, invalid_input: k.errorInvalid, version_conflict: k.errorConflict, unauthorized: k.errorUnauthorized, generic: k.errorGeneric };
  const sel: KbEntry | null = state.selected;
  const now = new Date();

  return (
    <>
      <Panel title={t.knowledgeTitle}>
        <p className="mb-6 text-sm leading-relaxed text-navy-600">{t.knowledgeHint}</p>
        <form method="get" className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <TextField name="q" label={k.search} defaultValue={one(sp.q) ?? ""} maxLength={120} />
          <SelectField name="category" label={t.category} defaultValue={category ?? ""} options={[{ value: "", label: k.all }, ...KB_CATEGORIES.map((c) => ({ value: c, label: t.categoryLabels[c] }))]} />
          <SelectField name="country" label={k.country} defaultValue={country ?? ""} options={[{ value: "", label: k.all }, ...COUNTRIES.map((c) => ({ value: c, label: c }))]} />
          <SelectField name="language" label={k.language} defaultValue={language ?? ""} options={[{ value: "", label: k.all }, ...LANGUAGES.map((c) => ({ value: c, label: c }))]} />
          <TextField name="tag" label={k.tag} defaultValue={one(sp.tag) ?? ""} maxLength={24} ltr />
          <div className="sm:col-span-2 lg:col-span-5">
            <button type="submit" className="rounded-full bg-navy-900 px-5 py-2 text-sm font-semibold text-white">{k.apply}</button>
          </div>
        </form>

        {state.entries.length === 0 ? (
          <p className="text-sm text-navy-600">{t.noKnowledge}</p>
        ) : (
          <DataTable head={[t.category, t.itemTitle, t.country, t.language, t.reliability, t.freshness, t.verifiedAt, t.sourceLink, k.open]}>
            {state.entries.map((entry) => {
              const freshness = freshnessOf(entry, now);
              const source = safeHttpsUrl(entry.officialSourceUrl);
              return (
                <tr key={entry.id} className="align-top hover:bg-navy-50/50">
                  <td className="px-4 py-3 text-sm text-navy-800">{t.categoryLabels[entry.category]}</td>
                  <td className="px-4 py-3 font-semibold text-navy-900">{truncate(entry.title, 120)}</td>
                  <td className="px-4 py-3 font-mono text-xs uppercase text-navy-700" dir="ltr">{entry.country}</td>
                  <td className="px-4 py-3 font-mono text-xs uppercase text-navy-700" dir="ltr">{entry.language}</td>
                  <td className="px-4 py-3 text-sm text-navy-800">{t.reliabilityLabels[entry.reliabilityStatus]}</td>
                  <td className="px-4 py-3"><Badge tone={freshnessTone(freshness)}>{t.freshnessLabels[freshness]}</Badge></td>
                  <td className="px-4 py-3 whitespace-nowrap">{entry.verifiedAt ? formatDateTime(entry.verifiedAt, locale) : "—"}</td>
                  <td className="px-4 py-3 text-xs">
                    {source ? (
                      <a href={source} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-navy-700 underline-offset-4 hover:underline">{t.sourceLink}</a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3"><a href={`?id=${entry.id}`} className="text-sm font-semibold text-navy-800 underline">{k.open}</a></td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Panel>

      {sel ? (
        <Panel title={`${k.selected}: ${sel.title}`}>
          <p className="mb-2 text-xs text-navy-500">{k.version} {sel.version} · {k.tags}: {sel.tags.join(", ") || "—"}</p>
          <p className="mb-4 whitespace-pre-wrap text-sm leading-relaxed text-navy-800">{sel.body}</p>
          {sel.reliabilityStatus === "retired" ? null : (
            <ActionForm action={retireKnowledgeAction} messages={messages} submitLabel={k.archive} pendingLabel={dict.common.loading} submitVariant="navy" confirmMessage={k.archiveConfirm}>
              <input type="hidden" name="id" value={sel.id} />
            </ActionForm>
          )}
          <p className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-navy-500">{k.history}</p>
          {state.history.length === 0 ? (
            <p className="text-sm text-navy-600">{k.noHistory}</p>
          ) : (
            <DataTable head={[k.version, k.replacedAt, t.itemTitle, k.content]}>
              {state.history.map((h) => (
                <tr key={`${h.entryId}-${h.version}`} className="align-top hover:bg-navy-50/50">
                  <td className="px-4 py-3 text-sm text-navy-800">{h.version}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-navy-800">{formatDateTime(h.replacedAt, locale)}</td>
                  <td className="px-4 py-3 text-sm text-navy-800">{h.title}</td>
                  <td className="px-4 py-3 text-sm text-navy-700">{truncate(h.body, 200)}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
      ) : null}

      <Panel title={sel ? k.editTitle : k.newTitle}>
        <p className="mb-4 text-sm leading-relaxed text-navy-600">{k.formHint}</p>
        <ActionForm action={saveKnowledgeAction} messages={messages} submitLabel={sel ? k.saveEdit : k.create} pendingLabel={dict.common.loading} submitVariant="navy" className="grid gap-4 sm:grid-cols-2">
          <SelectField name="category" label={t.category} required defaultValue={sel?.category ?? "customer_faq"} options={KB_CATEGORIES.map((c) => ({ value: c, label: t.categoryLabels[c] }))} />
          <TextField name="slug" label={k.slug} required maxLength={80} ltr defaultValue={sel?.slug ?? ""} />
          <SelectField name="language" label={k.language} required defaultValue={sel?.language ?? locale} options={LANGUAGES.map((c) => ({ value: c, label: c }))} />
          <SelectField name="country" label={k.country} required defaultValue={sel?.country ?? "all"} options={COUNTRIES.map((c) => ({ value: c, label: c }))} />
          <TextField name="title" label={t.itemTitle} required maxLength={160} defaultValue={sel?.title ?? ""} />
          <TextField name="officialSourceUrl" label={t.sourceLink} type="url" maxLength={500} ltr defaultValue={sel?.officialSourceUrl ?? ""} />
          <TextAreaField name="body" label={k.content} required maxLength={8000} rows={6} defaultValue={sel?.body ?? ""} />
          <TextField name="tags" label={k.tags} ltr defaultValue={sel?.tags.join(", ") ?? ""} />
          <SelectField name="reliabilityStatus" label={t.reliability} required defaultValue={sel?.reliabilityStatus ?? "unverified"} options={RELIABILITY_STATUSES.map((r) => ({ value: r, label: t.reliabilityLabels[r] }))} />
          <TextField name="verifiedAt" label={k.verifiedDate} type="date" />
          <p className="text-xs text-navy-500 sm:col-span-2">{k.formNote}</p>
        </ActionForm>
      </Panel>
    </>
  );
}
