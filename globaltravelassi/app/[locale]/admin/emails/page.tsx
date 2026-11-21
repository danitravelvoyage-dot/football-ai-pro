import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, formatDateTime, type Locale } from "@/lib/i18n";
import { formMessages } from "@/lib/validation/messages";
import { getCustomerEmailLog } from "@/lib/queries";
import { readEmailConfig } from "@/lib/email/config";
import { retryFailedEmailsAction } from "@/lib/actions/admin";
import { ActionForm } from "@/components/forms/ActionForm";
import { Panel } from "@/components/admin/AdminUI";
import { Alert, Badge } from "@/components/ui";

export const metadata: Metadata = { title: "Customer emails", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const tone = { sent: "success", failed: "danger", pending: "warning", skipped: "neutral" } as const;

/** Owner only (the admin layout checks the role). Shows the email log; never shows an email's content or any secret. */
export default async function AdminEmailsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const ce = dict.customerEmails;
  const delivery = readEmailConfig();
  const rows = await getCustomerEmailLog({ limit: 100 });
  const retryable = rows.filter((r) => r.status === "failed" && r.attempts < 5).length;

  return (
    <>
      <Panel title={ce.title}>
        <p className="text-sm leading-relaxed text-navy-600">{ce.intro}</p>
        <div className="mt-4">
          <Alert tone={delivery.ok ? "success" : "warning"}>{delivery.ok ? ce.deliveryOn : ce.deliveryOff}</Alert>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-navy-500">{ce.pendingNote}</p>
        <p className="mt-4 text-sm font-semibold text-navy-900">{ce.failedCount}: {retryable}</p>
        {retryable > 0 && (
          <div className="mt-3">
            <ActionForm action={retryFailedEmailsAction} messages={formMessages(dict)} submitLabel={ce.retry} pendingLabel={dict.common.loading} submitVariant="navy" className="grid gap-3">
              <input type="hidden" name="locale" value={locale} />
            </ActionForm>
          </div>
        )}
      </Panel>

      <Panel title={ce.kind}>
        {rows.length === 0 ? (
          <p className="text-sm text-navy-600">{ce.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-start text-sm">
              <thead className="text-navy-500">
                <tr>
                  <th className="py-2 text-start font-semibold">{ce.date}</th>
                  <th className="py-2 text-start font-semibold">{ce.kind}</th>
                  <th className="py-2 text-start font-semibold">{dict.dashboard.reference}</th>
                  <th className="py-2 text-start font-semibold">{ce.recipient}</th>
                  <th className="py-2 text-start font-semibold">{ce.status}</th>
                  <th className="py-2 text-start font-semibold">{ce.attempts}</th>
                  <th className="py-2 text-start font-semibold">{ce.error}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="py-3">{formatDateTime(r.created_at, locale)}</td>
                    <td className="py-3">{(ce.kinds as Record<string, string>)[r.kind] ?? r.kind}</td>
                    <td className="py-3 font-mono" dir="ltr">
                      {r.application_id ? (
                        <Link href={`/${locale}/admin/applications/${r.application_id}`} className="font-semibold text-navy-800 hover:text-gold-600">{r.template_data?.reference ?? "—"}</Link>
                      ) : (r.template_data?.reference ?? "—")}
                    </td>
                    <td className="py-3" dir="ltr">{r.recipient || "—"}</td>
                    <td className="py-3"><Badge tone={tone[r.status]}>{ce.statuses[r.status]}</Badge></td>
                    <td className="py-3">{r.attempts}</td>
                    <td className="py-3 font-mono text-xs" dir="ltr">{r.last_error ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
