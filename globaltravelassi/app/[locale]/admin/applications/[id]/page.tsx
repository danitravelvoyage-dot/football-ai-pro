import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, formatDate, formatDateTime, countryName, type Locale } from "@/lib/i18n";
import { getAdminApplicationDetail } from "@/lib/queries";
import { applicationStatuses, customerCategories, contactChannels, employmentStatuses, leadSources, normalizeStatus } from "@/lib/domain";
import { serviceTitle } from "@/lib/catalog";
import { whatsappLink } from "@/lib/config";
import { formMessages } from "@/lib/validation/messages";
import {
  addNoteAction, correctLeadSourceAction, deleteApplicationAction, logContactAction, setCustomerCategoryAction,
  setDocumentVerifiedAction, updateStatusAction,
} from "@/lib/actions/admin";
import { ActionForm } from "@/components/forms/ActionForm";
import { SelectField, TextAreaField, TextField } from "@/components/forms/Fields";
import { Panel } from "@/components/admin/AdminUI";
import { ChecklistList, QualificationSummary } from "@/components/admin/LeadInsights";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge, Card } from "@/components/ui";
import { qualifyLead } from "@/lib/crm/insights";

export const metadata: Metadata = { title: "Application", robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AdminApplicationPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale: raw, id } = await params;
  if (!isLocale(raw) || !UUID.test(id)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const t = dict.admin.detail;
  const c = dict.crm;
  const messages = formMessages(dict);
  const { application: app, documents, notes, events, activity, history } = await getAdminApplicationDetail(id);
  if (!app) notFound();

  const status = normalizeStatus(app.status);
  const wa = whatsappLink(`${app.reference}`);
  const typeLabels = dict.docTypes as Record<string, string>;
  const statusOptions = applicationStatuses.map((s) => ({ value: s, label: dict.statuses[s] }));
  const sourceOptions = leadSources.map((s) => ({ value: s, label: c.leadSources[s] }));
  const categoryOptions = customerCategories.map((s) => ({ value: s, label: c.categories[s] }));
  const channelOptions = contactChannels.map((s) => ({ value: s, label: c.channels[s] }));
  const sourceLabel = app.lead_source ? c.leadSources[app.lead_source] : c.leadSources.not_recorded;
  const qualification = qualifyLead({ ...app, category: app.services?.category, documents }, new Date());

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/${locale}/admin/applications`} className="text-sm font-semibold text-navy-600 hover:text-gold-600">← {t.backToList}</Link>
      </div>

      <header className="flex flex-col gap-4 rounded-[2rem] bg-navy-950 p-6 text-white sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gold-400">{t.title}</p>
          <p className="mt-2 font-mono text-2xl font-semibold" dir="ltr">{app.reference}</p>
          <p className="mt-1 text-navy-200">{app.services ? serviceTitle(app.services, locale) : ""}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge tone="gold">{c.categories[app.customer_category]}</Badge>
            <Badge tone="info">{c.leadSource}: {sourceLabel}</Badge>
            <Badge tone="neutral">{dict.langNames[app.locale as Locale] ?? app.locale}</Badge>
          </div>
        </div>
        <StatusBadge status={status} dict={dict} />
      </header>

      <div className="grid gap-8 xl:grid-cols-3">
        <div className="space-y-8 xl:col-span-2">
          <Panel title={dict.insights.qualificationTitle}>
            <QualificationSummary qualification={qualification} dict={dict} />
          </Panel>

          <Panel title={t.changeStatus}>
            <ActionForm action={updateStatusAction} messages={messages} submitLabel={t.changeStatus} pendingLabel={dict.common.loading} className="grid gap-5 sm:grid-cols-2">
              <input type="hidden" name="applicationId" value={app.id} />
              <SelectField name="status" label={t.changeStatus} options={statusOptions} defaultValue={status} required />
              <div className="sm:col-span-2">
                <TextField name="message" label={t.statusMessage} maxLength={300} hint={c.statusMessageHint} />
              </div>
            </ActionForm>
          </Panel>

          <Panel title={`${t.documents} (${documents.length})`}>
            {documents.length === 0 ? (
              <p className="text-sm text-navy-600">{t.noDocs}</p>
            ) : (
              <ul className="divide-y divide-navy-100">
                {documents.map((d) => (
                  <li key={d.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-semibold text-navy-900">{typeLabels[d.doc_type]}</p>
                      <p className="truncate text-sm text-navy-500" dir="ltr">{d.file_name}</p>
                      <p className="text-xs text-navy-500">{formatDate(d.created_at, locale)} · {Math.round(d.size_bytes / 1024)} KB</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <Badge tone={d.verified ? "success" : "warning"}>{d.verified ? dict.dashboard.verified : dict.dashboard.notChecked}</Badge>
                      <a href={`/${locale}/documents/${d.id}`} className="text-sm font-semibold text-navy-800 hover:text-gold-600">{dict.common.download}</a>
                      <ActionForm action={setDocumentVerifiedAction} messages={messages} submitLabel={d.verified ? t.unverify : t.verify} pendingLabel={dict.common.loading} submitVariant="navy" className="inline">
                        <input type="hidden" name="documentId" value={d.id} />
                        <input type="hidden" name="verified" value={d.verified ? "false" : "true"} />
                      </ActionForm>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={dict.insights.checklistTitle}>
            <p className="mb-4 text-xs leading-relaxed text-navy-500">{dict.insights.checklistNote}</p>
            <ChecklistList checklist={qualification.checklist} dict={dict} />
          </Panel>

          <Panel title={c.contactTitle}>
            <p className="mb-2 text-sm text-navy-700">
              {c.lastContact}: {app.last_contacted_at
                ? `${formatDateTime(app.last_contacted_at, locale)} · ${app.last_contact_channel ? c.channels[app.last_contact_channel] : ""}`
                : c.neverContacted}
            </p>
            <p className="mb-5 text-xs leading-relaxed text-navy-500">{c.whatsappHint}</p>
            <div className="mb-6 flex flex-wrap gap-3">
              {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#25D366] px-5 py-2.5 text-sm font-semibold text-white">{c.openWhatsapp}</a>}
            </div>
            <ActionForm action={logContactAction} messages={messages} submitLabel={c.contactSubmit} pendingLabel={dict.common.loading} submitVariant="navy" className="grid gap-5 sm:grid-cols-2">
              <input type="hidden" name="applicationId" value={app.id} />
              <SelectField name="channel" label={c.contactChannel} options={channelOptions} defaultValue="whatsapp" required />
              <TextField name="note" label={c.contactNote} maxLength={300} />
            </ActionForm>
          </Panel>

          <Panel title={t.notes}>
            <p className="mb-5 text-sm text-navy-600">{t.notesHint}</p>
            <ActionForm action={addNoteAction} messages={messages} submitLabel={t.addNote} pendingLabel={dict.common.loading} submitVariant="navy" resetOnSuccess className="space-y-4">
              <input type="hidden" name="applicationId" value={app.id} />
              <TextAreaField name="body" label={t.notes} rows={3} maxLength={2000} placeholder={t.notePlaceholder} required />
            </ActionForm>
            <ul className="mt-8 space-y-4">
              {notes.length === 0 && <li className="text-sm text-navy-600">{t.noNotes}</li>}
              {notes.map((n) => (
                <li key={n.id} className="rounded-2xl bg-navy-50 p-4">
                  <p className="whitespace-pre-line text-sm leading-relaxed text-navy-900">{n.body}</p>
                  <p className="mt-2 text-xs text-navy-500">{formatDateTime(n.created_at, locale)}</p>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title={c.activity}>
            <p className="mb-4 text-xs leading-relaxed text-navy-500">{c.activityNote}</p>
            {activity.length === 0 ? (
              <p className="text-sm text-navy-600">{c.noActivity}</p>
            ) : (
              <ul className="divide-y divide-navy-100 text-sm">
                {activity.map((a) => (
                  <li key={a.id} className="py-3">
                    <p className="font-semibold text-navy-900">{c.activityKinds[a.kind as keyof typeof c.activityKinds] ?? a.kind}</p>
                    <p className="whitespace-pre-line text-navy-700">{a.detail}</p>
                    <p className="text-xs text-navy-500">{formatDateTime(a.created_at, locale)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <aside className="space-y-8">
          <Card>
            <h2 className="font-display text-xl text-navy-900">{t.customer}</h2>
            <dl className="mt-5 space-y-4 text-sm">
              <div><dt className="text-navy-500">{dict.apply.fields.fullName}</dt><dd className="mt-1 font-semibold text-navy-900">{app.full_name}</dd></div>
              <div><dt className="text-navy-500">{t.contact}</dt><dd className="mt-1 break-all text-navy-900" dir="ltr">{app.email}</dd></div>
              <div><dt className="text-navy-500">{dict.apply.fields.whatsapp}</dt><dd className="mt-1 font-semibold text-navy-900" dir="ltr">{app.whatsapp}</dd></div>
              <div><dt className="text-navy-500">{t.nationality}</dt><dd className="mt-1 text-navy-900">{countryName(app.nationality, locale)}</dd></div>
              <div><dt className="text-navy-500">{t.residence}</dt><dd className="mt-1 text-navy-900">{countryName(app.country_of_residence, locale)}</dd></div>
              <div><dt className="text-navy-500">{t.submitted}</dt><dd className="mt-1 text-navy-900">{formatDateTime(app.created_at, locale)}</dd></div>
            </dl>
            {app.profiles && <p className="mt-4 text-xs text-navy-500">{app.profiles.is_active ? dict.common.active : dict.common.inactive}</p>}
          </Card>

          <Card>
            <h2 className="font-display text-xl text-navy-900">{c.leadSource}</h2>
            <p className="mt-3 text-sm text-navy-900">{sourceLabel}{app.lead_source_detail ? ` · ${app.lead_source_detail}` : ""}</p>
            <p className="mt-2 text-xs leading-relaxed text-navy-500">{c.sourceNotice}</p>
            {app.lead_source_corrected_at && (
              <p className="mt-2 text-xs text-navy-500">{c.correctedAt}: {formatDateTime(app.lead_source_corrected_at, locale)}</p>
            )}
            <div className="mt-5">
              <ActionForm action={correctLeadSourceAction} messages={messages} submitLabel={c.correctSubmit} pendingLabel={dict.common.loading} submitVariant="navy" className="grid gap-4">
                <input type="hidden" name="applicationId" value={app.id} />
                <SelectField name="leadSource" label={c.correctSource} options={sourceOptions} defaultValue={app.lead_source ?? "other"} required />
                <TextField name="reason" label={c.correctReason} required maxLength={300} />
              </ActionForm>
            </div>
          </Card>

          <Card>
            <h2 className="font-display text-xl text-navy-900">{c.category}</h2>
            <div className="mt-5">
              <ActionForm action={setCustomerCategoryAction} messages={messages} submitLabel={c.saveCategory} pendingLabel={dict.common.loading} submitVariant="navy" className="grid gap-4">
                <input type="hidden" name="applicationId" value={app.id} />
                <SelectField name="category" label={c.category} options={categoryOptions} defaultValue={app.customer_category} required />
              </ActionForm>
            </div>
          </Card>

          <Card>
            <h2 className="font-display text-xl text-navy-900">{t.travel}</h2>
            <dl className="mt-5 space-y-4 text-sm">
              <div><dt className="text-navy-500">{t.destination}</dt><dd className="mt-1 font-semibold text-navy-900">{countryName(app.destination_country, locale)}</dd></div>
              <div><dt className="text-navy-500">{t.travelDate}</dt><dd className="mt-1 text-navy-900">{formatDate(app.travel_date, locale)}</dd></div>
              <div><dt className="text-navy-500">{t.employment}</dt><dd className="mt-1 text-navy-900">{dict.employment[app.employment_status as (typeof employmentStatuses)[number]]}</dd></div>
              <div><dt className="text-navy-500">{t.previous}</dt><dd className="mt-1 whitespace-pre-line text-navy-900">{app.previous_travel_history || "—"}</dd></div>
              <div><dt className="text-navy-500">{t.additional}</dt><dd className="mt-1 whitespace-pre-line text-navy-900">{app.additional_info || "—"}</dd></div>
            </dl>
          </Card>

          <Card>
            <h2 className="font-display text-xl text-navy-900">{c.otherRequests}</h2>
            {history.length === 0 ? (
              <p className="mt-4 text-sm text-navy-600">{c.noOtherRequests}</p>
            ) : (
              <ul className="mt-4 divide-y divide-navy-100 text-sm">
                {history.map((h) => (
                  <li key={h.id} className="py-3">
                    <Link href={`/${locale}/admin/applications/${h.id}`} className="font-mono font-semibold text-navy-900 hover:text-gold-600" dir="ltr">{h.reference}</Link>
                    <p className="text-xs text-navy-500">{dict.statuses[normalizeStatus(h.status)]} · {formatDate(h.created_at, locale)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="font-display text-xl text-navy-900">{t.timeline}</h2>
            <p className="mt-2 text-xs text-navy-500">{t.timelineHint}</p>
            <ol className="mt-5 space-y-4 border-s border-gold-300 ps-5">
              {events.map((e) => (
                <li key={e.id} className="relative text-sm">
                  <span className="absolute -start-[1.45rem] top-1.5 size-2.5 rounded-full bg-gold-500" aria-hidden />
                  <p className="font-semibold text-navy-900">
                    {e.kind === "created" ? dict.apply.successTitle : e.kind === "status" && e.to_status ? dict.statuses[normalizeStatus(e.to_status)] : e.message}
                  </p>
                  {e.kind === "status" && e.message && <p className="text-navy-700">{e.message}</p>}
                  <p className="text-xs text-navy-500">{formatDateTime(e.created_at, locale)}</p>
                </li>
              ))}
            </ol>
          </Card>

          <Card className="border-rose-200">
            <h2 className="font-display text-xl text-rose-800">{t.dangerZone}</h2>
            <ActionForm action={deleteApplicationAction} messages={{ ...messages, protected_records: c.protectedRecords, files_remaining: c.filesRemaining }} submitLabel={t.dangerZone} pendingLabel={dict.common.loading} submitVariant="navy" confirmMessage={t.confirmDelete} className="mt-4">
              <input type="hidden" name="applicationId" value={app.id} />
              <input type="hidden" name="locale" value={locale} />
            </ActionForm>
          </Card>
        </aside>
      </div>
    </div>
  );
}
