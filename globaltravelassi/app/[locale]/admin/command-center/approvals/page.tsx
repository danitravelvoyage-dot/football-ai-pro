import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, formatDateTime, type Locale } from "@/lib/i18n";
import { loadCommandCenter } from "@/lib/ai/command-center/load";
import { riskTone, truncate } from "@/lib/ai/command-center/view";
import { decideApprovalAction } from "@/lib/actions/ai";
import { ActionForm } from "@/components/forms/ActionForm";
import { SelectField, TextField } from "@/components/forms/Fields";
import { formMessages } from "@/lib/validation/messages";
import { Badge } from "@/components/ui";
import { DataTable, Panel } from "@/components/admin/AdminUI";
import { LoadState } from "@/components/admin/command-center/Parts";

export const metadata: Metadata = { title: "Approvals", robots: { index: false, follow: false } };

export default async function ApprovalsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const t = dict.commandCenter;
  const messages = formMessages(dict);

  const state = await loadCommandCenter();
  if (state.status !== "ok") return <LoadState kind={state.status} dict={dict} />;
  const { approvals, report } = state;

  const pending = approvals.filter((a) => a.status === "pending");
  const history = approvals
    .filter((a) => a.status !== "pending")
    .sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""))
    .slice(0, 20);

  return (
    <>
      <p className="text-sm leading-relaxed text-navy-600">{t.approvalsHint}</p>

      <Panel title={t.approvalsTitle}>
        {pending.length === 0 ? (
          <p className="text-sm text-navy-600">{t.noApprovals}</p>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            {pending.map((approval) => (
              <article key={approval.id} className="flex flex-col gap-4 rounded-2xl border border-navy-100 bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-mono text-xs text-navy-700" dir="ltr">{approval.actionClass}</p>
                  <Badge tone={riskTone(approval.riskLevel)}>{t.riskLabels[approval.riskLevel]}</Badge>
                </div>
                <p className="text-sm leading-relaxed text-navy-900">{approval.summary}</p>
                <details className="rounded-2xl bg-navy-50/60 p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-navy-800">{t.preview}</summary>
                  <pre dir="ltr" className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-navy-800">
                    {truncate(JSON.stringify(approval.preview ?? null, null, 2), 2000)}
                  </pre>
                </details>
                <ActionForm
                  action={decideApprovalAction}
                  messages={messages}
                  submitLabel={t.decisionSubmit}
                  pendingLabel={dict.common.loading}
                  submitVariant="navy"
                  resetOnSuccess
                  className="grid gap-4 sm:grid-cols-2"
                >
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="approvalId" value={approval.id} />
                  <SelectField
                    name="decision"
                    label={t.decisionLabel}
                    required
                    defaultValue="approved"
                    options={[
                      { value: "approved", label: t.approve },
                      { value: "rejected", label: t.reject },
                    ]}
                  />
                  <TextField name="note" label={t.decisionNote} maxLength={500} />
                </ActionForm>
              </article>
            ))}
          </div>
        )}
      </Panel>

      <Panel title={t.externalWaiting}>
        <p className="mb-4 text-sm text-navy-600">{t.externalNote}</p>
        {report.externalItems.length === 0 ? (
          <p className="text-sm text-navy-500">{t.noData}</p>
        ) : (
          <DataTable head={[t.action, t.status, t.task]}>
            {report.externalItems.map((item) => (
              <tr key={item.approvalId} className="hover:bg-navy-50/50">
                <td className="px-4 py-3 font-mono text-xs text-navy-800" dir="ltr">{item.action}</td>
                <td className="px-4 py-3 font-semibold text-navy-900">{t.extStatus[item.status]}</td>
                <td className="px-4 py-3 font-mono text-xs text-navy-500" dir="ltr">{item.taskId}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <Panel title={t.decidedHistory}>
        {history.length === 0 ? (
          <p className="text-sm text-navy-600">{t.noData}</p>
        ) : (
          <DataTable head={[t.action, t.decisionLabel, t.when, t.decisionNote]}>
            {history.map((a) => (
              <tr key={a.id} className="align-top hover:bg-navy-50/50">
                <td className="px-4 py-3 font-mono text-xs text-navy-800" dir="ltr">{a.actionClass}</td>
                <td className="px-4 py-3 font-semibold text-navy-900">
                  {a.status === "approved" ? t.approve : a.status === "expired" ? t.extStatus.expired : t.reject}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(a.decidedAt, locale)}</td>
                <td className="px-4 py-3 text-xs text-navy-600">{a.decisionNote ?? "—"}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
    </>
  );
}
