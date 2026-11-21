import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, formatDate, formatDateTime, formatMoney, countryName, type Locale } from "@/lib/i18n";
import { getAdminApplicationDetail } from "@/lib/queries";
import { applicationStatuses, currencies, employmentStatuses, paymentMethods, paymentStatuses, type ApplicationStatus } from "@/lib/domain";
import { serviceTitle } from "@/lib/catalog";
import { whatsappLink } from "@/lib/config";
import { formMessages } from "@/lib/validation/messages";
import { addNoteAction, deleteApplicationAction, recordPaymentAction, setDocumentVerifiedAction, setPaymentStatusAction, updateStatusAction } from "@/lib/actions/admin";
import { decidePaymentAction } from "@/lib/actions/payments";
import { isDecidable } from "@/lib/payments/rules";
import { loadProofLinks } from "@/lib/payments/load";
import { ActionForm } from "@/components/forms/ActionForm";
import { SelectField, TextAreaField, TextField } from "@/components/forms/Fields";
import { Panel } from "@/components/admin/AdminUI";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge, Card } from "@/components/ui";

export const metadata: Metadata = { title: "Application", robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AdminApplicationPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale: raw, id } = await params;
  if (!isLocale(raw) || !UUID.test(id)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const t = dict.admin.detail;
  const messages = { ...formMessages(dict), protected_records: dict.manualPayments.protectedRecords, files_remaining: dict.manualPayments.filesRemaining };
  const { application: app, documents, payments, notes, events } = await getAdminApplicationDetail(id);
  const mp = dict.manualPayments;
  const proofLinks = await loadProofLinks(payments.flatMap((p) => (p.evidence_path ? [p.evidence_path] : [])));
  const paymentMessages = {
    ...formMessages(dict),
    saved: mp.decided,
    confirmed: mp.decided,
    rejected: mp.decided,
    already_decided: mp.alreadyDecided,
    forbidden: mp.forbidden,
    unauthorized: mp.unauthorized,
    invalid_input: mp.invalid,
    not_found: mp.notFound,
    generic: mp.generic,
  };
  if (!app) notFound();

  const status = app.status as ApplicationStatus;
  const wa = whatsappLink(`${app.reference}`);
  const received: Record<string, number> = {};
  for (const p of payments) if (p.status === "received") received[p.currency] = (received[p.currency] ?? 0) + Number(p.amount);
  // "Payment pending" is set by a proof submission only; it is listed only to show the current state.
  const statusOptions = applicationStatuses
    .filter((s) => s !== "payment_pending" || status === "payment_pending")
    .map((s) => ({ value: s, label: dict.statuses[s] }));
  const currencyOptions = currencies.map((c) => ({ value: c, label: c }));
  const methodOptions = paymentMethods.map((m) => ({ value: m, label: dict.paymentMethods[m] }));
  const paymentStatusOptions = paymentStatuses.map((s) => ({ value: s, label: dict.paymentStatuses[s] }));
  const typeLabels = dict.docTypes as Record<string, string>;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/${locale}/admin/applications`} className="text-sm font-semibold text-navy-600 hover:text-gold-600">← {t.backToList}</Link>
      </div>

      <header className="flex flex-col gap-4 rounded-[2rem] bg-navy-950 p-6 text-white sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gold-400">{t.title}</p>
          <p className="mt-2 font-mono text-2xl font-semibold">{app.reference}</p>
          <p className="mt-1 text-navy-200">{app.services ? serviceTitle(app.services, locale) : ""}</p>
        </div>
        <StatusBadge status={status} dict={dict} />
      </header>

      <div className="grid gap-8 xl:grid-cols-3">
        <div className="space-y-8 xl:col-span-2">
          {/* Change status */}
          <Panel title={t.changeStatus}>
            <ActionForm action={updateStatusAction} messages={messages} submitLabel={t.changeStatus} pendingLabel={dict.common.loading} className="grid gap-5 sm:grid-cols-2">
              <input type="hidden" name="applicationId" value={app.id} />
              <SelectField name="status" label={t.changeStatus} options={statusOptions} defaultValue={status} required />
              <div className="sm:col-span-2">
                <TextField name="message" label={t.statusMessage} maxLength={300} />
              </div>
            </ActionForm>
          </Panel>

          {/* Documents */}
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

          {/* Payments */}
          <Panel title={t.payments}>
            <p className="mb-5 text-sm text-navy-600">{t.balanceNote}</p>
            <div className="mb-6 flex flex-wrap gap-3">
              {Object.keys(received).length === 0 ? (
                <Badge>{t.totalReceived}: —</Badge>
              ) : (
                Object.entries(received).map(([c, v]) => <Badge key={c} tone="success">{t.totalReceived}: {formatMoney(v, c, locale)}</Badge>)
              )}
            </div>
            {payments.length === 0 ? (
              <p className="mb-6 text-sm text-navy-600">{t.noPayments}</p>
            ) : (
              <ul className="mb-8 divide-y divide-navy-100">
                {payments.map((p) => (
                  <li key={p.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-semibold text-navy-900">{formatMoney(p.amount, p.currency, locale)} · {dict.paymentMethods[p.method]}</p>
                      <p className="text-xs text-navy-500">{dict.paymentStatuses[p.status]} {p.received_at ? `· ${formatDate(p.received_at, locale)}` : ""} {p.reference ? `· ${p.reference}` : ""}</p>
                      {p.note && <p className="mt-1 text-xs text-navy-500">{p.note}</p>}
                    </div>
                    {!p.evidence_path && (
                    <div className="flex flex-wrap gap-2">
                      {p.status !== "received" && (
                        <ActionForm action={setPaymentStatusAction} messages={messages} submitLabel={t.markReceived} pendingLabel={dict.common.loading} submitVariant="navy" className="inline">
                          <input type="hidden" name="paymentId" value={p.id} />
                          <input type="hidden" name="status" value="received" />
                        </ActionForm>
                      )}
                      {p.status !== "cancelled" && (
                        <ActionForm action={setPaymentStatusAction} messages={messages} submitLabel={t.markCancelled} pendingLabel={dict.common.loading} submitVariant="navy" confirmMessage={t.markCancelled + "?"} className="inline">
                          <input type="hidden" name="paymentId" value={p.id} />
                          <input type="hidden" name="status" value="cancelled" />
                        </ActionForm>
                      )}
                    </div>
                    )}
                    {p.evidence_path && (
                      <div className="w-full space-y-3 rounded-2xl bg-navy-50/60 p-4">
                        <p className="text-xs leading-relaxed text-navy-600">{mp.proofNote}</p>
                        {proofLinks.get(p.evidence_path) ? (
                          <a href={proofLinks.get(p.evidence_path)} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-gold-700 underline">{mp.proof}</a>
                        ) : (
                          <p className="text-xs text-rose-700">{mp.generic}</p>
                        )}
                        {p.verified_at && (
                          <p className="text-xs text-navy-600">
                            {mp.verifiedBy}: <span dir="ltr" className="font-mono">{p.verified_by ?? "—"}</span> · {mp.verifiedAt}: {formatDateTime(p.verified_at, locale)}
                          </p>
                        )}
                        {p.decision_reason && <p className="text-xs text-navy-700">{p.decision_reason}</p>}
                        {isDecidable(p.status) && (
                          <ActionForm action={decidePaymentAction} messages={paymentMessages} submitLabel={mp.decide} pendingLabel={dict.common.loading} submitVariant="navy" className="grid gap-3 sm:grid-cols-2">
                            <input type="hidden" name="paymentId" value={p.id} />
                            <SelectField name="decision" label={mp.decideTitle} required defaultValue="approve" options={[{ value: "approve", label: mp.approve }, { value: "reject", label: mp.reject }]} />
                            <TextField name="reason" label={mp.reasonLabel} required maxLength={500} />
                            <div className="sm:col-span-2">
                              <TextAreaField name="customerMessage" label={mp.customerMessageLabel} rows={3} maxLength={500} />
                              <p className="mt-1 text-xs text-navy-500">{mp.customerMessageHint}</p>
                            </div>
                          </ActionForm>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <h3 className="mb-4 font-semibold text-navy-900">{t.recordPayment}</h3>
            <ActionForm action={recordPaymentAction} messages={messages} submitLabel={t.recordPayment} pendingLabel={dict.common.loading} className="grid gap-5 sm:grid-cols-2">
              <input type="hidden" name="applicationId" value={app.id} />
              <TextField name="amount" label={t.amount} inputMode="decimal" ltr required />
              <SelectField name="currency" label={t.currency} options={currencyOptions} defaultValue="DZD" required />
              <SelectField name="method" label={t.method} options={methodOptions} defaultValue="cash" required />
              <SelectField name="status" label={t.paymentStatus} options={paymentStatusOptions} defaultValue="received" required />
              <TextField name="reference" label={t.paymentRef} maxLength={100} ltr />
              <TextField name="receivedOn" label={t.receivedOn} type="date" ltr />
              <div className="sm:col-span-2">
                <TextField name="note" label={t.paymentNote} maxLength={500} />
              </div>
            </ActionForm>
          </Panel>

          {/* Internal notes */}
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
              <div><dt className="text-navy-500">{t.source}</dt><dd className="mt-1 text-navy-900">{app.source || "—"}</dd></div>
            </dl>
            <div className="mt-6 flex flex-col gap-3">
              {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#25D366] px-5 py-2.5 text-sm font-semibold text-white">{dict.nav.whatsapp}</a>}
              {app.profiles && <p className="text-xs text-navy-500">{app.profiles.is_active ? dict.common.active : dict.common.inactive}</p>}
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
            <h2 className="font-display text-xl text-navy-900">{t.timeline}</h2>
            <p className="mt-2 text-xs text-navy-500">{t.timelineHint}</p>
            <ol className="mt-5 space-y-4 border-s border-gold-300 ps-5">
              {events.map((e) => (
                <li key={e.id} className="relative text-sm">
                  <span className="absolute -start-[1.45rem] top-1.5 size-2.5 rounded-full bg-gold-500" aria-hidden />
                  <p className="font-semibold text-navy-900">
                    {e.kind === "created" ? dict.apply.successTitle : e.kind === "status" && e.to_status ? dict.statuses[e.to_status] : e.kind === "payment" ? `${dict.dashboard.payments}: ${e.message}` : e.message}
                  </p>
                  {e.kind === "status" && e.message && <p className="text-navy-700">{e.message}</p>}
                  <p className="text-xs text-navy-500">{formatDateTime(e.created_at, locale)}</p>
                </li>
              ))}
            </ol>
          </Card>

          <Card className="border-rose-200">
            <h2 className="font-display text-xl text-rose-800">{t.dangerZone}</h2>
            <ActionForm action={deleteApplicationAction} messages={messages} submitLabel={t.dangerZone} pendingLabel={dict.common.loading} submitVariant="navy" confirmMessage={t.confirmDelete} className="mt-4">
              <input type="hidden" name="applicationId" value={app.id} />
              <input type="hidden" name="locale" value={locale} />
            </ActionForm>
          </Card>
        </aside>
      </div>
    </div>
  );
}
