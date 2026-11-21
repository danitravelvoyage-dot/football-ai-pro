import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, formatDateTime, type Locale } from "@/lib/i18n";
import { formMessages } from "@/lib/validation/messages";
import { loadContentInbox } from "@/lib/ai/content/load";
import { decideContentAction } from "@/lib/actions/campaigns";
import { ActionForm } from "@/components/forms/ActionForm";
import { TextAreaField } from "@/components/forms/Fields";
import { DataTable, Panel } from "@/components/admin/AdminUI";
import { LoadState } from "@/components/admin/command-center/Parts";
import { Badge } from "@/components/ui";

export const metadata: Metadata = { title: "Content review", robots: { index: false, follow: false } };

const QUALITY_TONE = { PASSED: "success", NEEDS_REVISION: "warning", REJECTED: "danger", REQUIRES_HUMAN_REVIEW: "info" } as const;

export default async function ContentPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const k = dict.commandCenter.contentUi;

  const state = await loadContentInbox();
  if (state.status === "unauthorized") return <p className="text-sm text-rose-800">{k.unauthorized}</p>;
  if (state.status !== "ok") return <LoadState kind={state.status} dict={dict} />;

  const messages = { ...formMessages(dict), saved: k.saved, forbidden: k.errorForbidden, invalid_input: k.errorInvalid, rule_refused: k.errorRule, unauthorized: k.errorUnauthorized, generic: k.errorGeneric };

  return (
    <>
      <p className="text-sm leading-relaxed text-navy-600">{k.hint}</p>
      <p className="text-sm text-navy-800">{k.pending}: <span className="font-semibold">{state.items.length}</span></p>

      {state.items.length === 0 ? (
        <Panel title={k.inbox}><p className="text-sm text-navy-600">{k.empty}</p></Panel>
      ) : (
        state.items.map((item) => (
          <Panel key={item.artifact.id} title={`${item.artifact.kind} · ${item.artifact.agent}`}>
            <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
              <Badge tone="gold">{k.statusLabels[item.artifact.status]}</Badge>
              <span className="text-navy-600">{item.artifact.language} · {item.artifact.country}</span>
              <span className="text-navy-500">{formatDateTime(item.artifact.createdAt, locale)}</span>
              {item.quality ? (
                <Badge tone={QUALITY_TONE[item.quality.status as keyof typeof QUALITY_TONE] ?? "neutral"}>
                  {k.qualityLabels[item.quality.status as keyof typeof k.qualityLabels] ?? item.quality.status} · {item.quality.overall}
                </Badge>
              ) : (
                <span className="text-navy-500">{k.noQuality}</span>
              )}
            </div>
            <pre className="mb-4 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-navy-50 p-4 text-sm text-navy-800" dir="ltr">
              {JSON.stringify(item.artifact.body, null, 2)}
            </pre>
            <div className="grid gap-4 lg:grid-cols-3">
              <ActionForm action={decideContentAction} messages={messages} submitLabel={k.approve} pendingLabel={dict.common.loading} submitVariant="navy">
                <input type="hidden" name="id" value={item.artifact.id} />
                <input type="hidden" name="decision" value="approved" />
                <p className="text-xs text-navy-500">{k.approveHint}</p>
              </ActionForm>
              <ActionForm action={decideContentAction} messages={messages} submitLabel={k.reject} pendingLabel={dict.common.loading} submitVariant="navy" confirmMessage={k.rejectConfirm} resetOnSuccess>
                <input type="hidden" name="id" value={item.artifact.id} />
                <input type="hidden" name="decision" value="rejected" />
                <TextAreaField name="note" label={k.reason} required maxLength={1000} rows={2} />
              </ActionForm>
              <ActionForm action={decideContentAction} messages={messages} submitLabel={k.requestRevision} pendingLabel={dict.common.loading} submitVariant="navy" resetOnSuccess>
                <input type="hidden" name="id" value={item.artifact.id} />
                <input type="hidden" name="decision" value="revision_requested" />
                <TextAreaField name="note" label={k.revisionNote} required maxLength={1000} rows={2} />
              </ActionForm>
            </div>
            <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-navy-500">{k.history}</p>
            {item.recentReviews.length === 0 ? (
              <p className="text-sm text-navy-600">{k.noHistory}</p>
            ) : (
              <DataTable head={[k.when, k.decision, k.reason]}>
                {item.recentReviews.map((r) => (
                  <tr key={r.id} className="align-top hover:bg-navy-50/50">
                    <td className="px-4 py-3 text-sm text-navy-800">{formatDateTime(r.reviewedAt, locale)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-navy-800" dir="ltr">{r.decision}</td>
                    <td className="px-4 py-3 text-sm text-navy-700">{r.note ?? "—"}</td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Panel>
        ))
      )}

      <p className="text-xs text-navy-500">{k.footnote}</p>
    </>
  );
}
