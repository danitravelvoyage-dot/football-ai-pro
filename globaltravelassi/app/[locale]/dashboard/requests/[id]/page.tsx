import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, formatDate, formatDateTime, countryName, type Locale } from "@/lib/i18n";
import { requireCustomer } from "@/lib/auth";
import { getApplicationWithService, getDocumentsFor, getTimelineFor } from "@/lib/queries";
import { serviceTitle } from "@/lib/catalog";
import { documentsEditableStatuses, normalizeStatus, type ApplicationStatus } from "@/lib/domain";
import { formMessages } from "@/lib/validation/messages";
import { deleteDocumentAction } from "@/lib/actions/documents";
import { whatsappLink } from "@/lib/config";
import { ActionForm } from "@/components/forms/ActionForm";
import { DocumentUploader } from "@/components/DocumentUploader";
import { StatusBadge } from "@/components/StatusBadge";
import { Alert, Badge, Card, ButtonLink } from "@/components/ui";

export const metadata: Metadata = { title: "Request", robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { locale: raw, id } = await params;
  if (!isLocale(raw) || !UUID.test(id)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const { user } = await requireCustomer(locale, `/${locale}/dashboard/requests/${id}`);
  const { created } = await searchParams;

  const app = await getApplicationWithService(id);
  if (!app) {
    return (
      <Card>
        <p className="text-navy-700">{dict.dashboard.noRequestFound}</p>
        <Link href={`/${locale}/dashboard`} className="mt-4 inline-block font-semibold text-gold-600">{dict.dashboard.backToList}</Link>
      </Card>
    );
  }
  const [documents, timeline] = await Promise.all([getDocumentsFor(id), getTimelineFor(id)]);
  const status = normalizeStatus(app.status);
  const editable = documentsEditableStatuses.includes(status as ApplicationStatus);
  const wa = whatsappLink(`${dict.dashboard.whatsappMessage} ${app.reference}`);
  const typeLabels = dict.docTypes as Record<string, string>;

  const eventText = (e: (typeof timeline)[number]) => {
    if (e.kind === "created") return dict.apply.successTitle;
    if (e.kind === "status" && e.to_status) return `${dict.statuses[normalizeStatus(e.to_status)]}${e.message ? ` — ${e.message}` : ""}`;
    return e.message || dict.common.none;
  };

  return (
    <div className="space-y-8">
      <Link href={`/${locale}/dashboard`} className="text-sm font-semibold text-navy-600 hover:text-gold-600">← {dict.dashboard.backToList}</Link>

      <header className="flex flex-col gap-4 rounded-[2rem] bg-navy-950 p-6 text-white sm:flex-row sm:items-center sm:justify-between sm:p-10">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gold-400">{dict.dashboard.reference}</p>
          <p className="mt-2 font-mono text-2xl font-semibold" dir="ltr">{app.reference}</p>
          <p className="mt-2 text-navy-200">{app.services ? serviceTitle(app.services, locale) : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={status} dict={dict} />
          {wa && <ButtonLink href={wa} external variant="whatsapp" className="min-h-10 px-5 py-2 text-sm">{dict.nav.whatsapp}</ButtonLink>}
        </div>
      </header>

      {created === "1" && <Alert tone="success">{dict.apply.successTitle}. {dict.apply.successText} <span dir="ltr" className="font-mono">{app.reference}</span>. {dict.apply.uploadHint}</Alert>}
      {status === "documents_required" && <Alert tone="warning">{dict.dashboard.waitingDocs}</Alert>}

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="space-y-8 lg:col-span-2">
          <Card>
            <h2 className="font-display text-2xl text-navy-900">{dict.dashboard.documents}</h2>
            {documents.length === 0 ? (
              <p className="mt-4 text-sm text-navy-600">{dict.dashboard.noDocs}</p>
            ) : (
              <ul className="mt-5 divide-y divide-navy-100">
                {documents.map((doc) => (
                  <li key={doc.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-semibold text-navy-900">{typeLabels[doc.doc_type]}</p>
                      <p className="truncate text-sm text-navy-500" dir="ltr">{doc.file_name}</p>
                      <p className="mt-1 text-xs text-navy-500">{formatDate(doc.created_at, locale)} · {Math.round(doc.size_bytes / 1024)} KB</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <Badge tone={doc.verified ? "success" : "neutral"}>{doc.verified ? dict.dashboard.verified : dict.dashboard.notChecked}</Badge>
                      <a href={`/${locale}/documents/${doc.id}`} className="text-sm font-semibold text-navy-800 hover:text-gold-600">{dict.common.download}</a>
                      {editable && (
                        <ActionForm action={deleteDocumentAction} messages={formMessages(dict)} submitLabel={dict.dashboard.removeDoc} pendingLabel={dict.common.loading} submitVariant="navy" confirmMessage={dict.dashboard.confirmRemove} className="inline">
                          <input type="hidden" name="documentId" value={doc.id} />
                        </ActionForm>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="font-display text-2xl text-navy-900">{dict.dashboard.uploadTitle}</h2>
            <p className="mt-2 text-sm text-navy-600">{dict.apply.uploadHint}</p>
            <div className="mt-6">
              {editable ? (
                <DocumentUploader
                  applicationId={app.id}
                  userId={user.id}
                  locale={locale}
                  labels={{
                    docType: dict.dashboard.docType,
                    chooseFile: dict.dashboard.chooseFile,
                    uploading: dict.dashboard.uploading,
                    uploaded: dict.dashboard.uploaded,
                    limits: dict.dashboard.uploadLimits,
                    fileTooLarge: dict.dashboard.fileTooLarge,
                    fileType: dict.dashboard.fileType,
                    genericError: dict.common.genericError,
                    locked: dict.dashboard.locked,
                    typeLabels,
                  }}
                />
              ) : (
                <Alert tone="info">{dict.dashboard.locked}</Alert>
              )}
            </div>
          </Card>

          <Card>
            <h2 className="font-display text-2xl text-navy-900">{dict.dashboard.contactTitle}</h2>
            <p className="mt-2 text-sm leading-relaxed text-navy-600">{dict.dashboard.contactText}</p>
            {wa && <div className="mt-5"><ButtonLink href={wa} external variant="whatsapp">{dict.nav.whatsapp}</ButtonLink></div>}
          </Card>
        </div>

        <aside className="space-y-8">
          <Card>
            <h2 className="font-display text-2xl text-navy-900">{dict.dashboard.timeline}</h2>
            {timeline.length === 0 ? (
              <p className="mt-4 text-sm text-navy-600">{dict.dashboard.noTimeline}</p>
            ) : (
              <ol className="mt-6 space-y-6 border-s border-gold-300 ps-6">
                {timeline.map((e) => (
                  <li key={e.id} className="relative">
                    <span className="absolute -start-[1.9rem] top-1 size-3 rounded-full bg-gold-500 ring-4 ring-gold-100" aria-hidden />
                    <p className="text-sm font-semibold text-navy-900">{eventText(e)}</p>
                    <p className="mt-1 text-xs text-navy-500">{formatDateTime(e.created_at, locale)}</p>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card>
            <h2 className="font-display text-2xl text-navy-900">{dict.dashboard.requestInfo}</h2>
            <dl className="mt-5 space-y-4 text-sm">
              <div><dt className="text-navy-500">{dict.apply.fields.fullName}</dt><dd className="mt-1 font-semibold text-navy-900">{app.full_name}</dd></div>
              <div><dt className="text-navy-500">{dict.apply.fields.destinationCountry}</dt><dd className="mt-1 font-semibold text-navy-900">{countryName(app.destination_country, locale)}</dd></div>
              <div><dt className="text-navy-500">{dict.dashboard.travelDate}</dt><dd className="mt-1 font-semibold text-navy-900">{formatDate(app.travel_date, locale)}</dd></div>
              <div><dt className="text-navy-500">{dict.dashboard.status}</dt><dd className="mt-1"><StatusBadge status={status} dict={dict} /></dd></div>
            </dl>
          </Card>
        </aside>
      </div>
    </div>
  );
}
