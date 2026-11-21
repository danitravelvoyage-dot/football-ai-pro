import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, formatDateTime, type Locale } from "@/lib/i18n";
import { formMessages } from "@/lib/validation/messages";
import { loadReview } from "@/lib/ai/review/load";
import { ALLOWED_DECISIONS, type ReviewKind } from "@/lib/ai/review/rules";
import type { ReviewItem } from "@/lib/ai/review/service";
import { decideReviewAction } from "@/lib/actions/review";
import { ActionForm } from "@/components/forms/ActionForm";
import { SelectField, TextField } from "@/components/forms/Fields";
import { DataTable, Panel } from "@/components/admin/AdminUI";
import { LoadState } from "@/components/admin/command-center/Parts";
import { Badge } from "@/components/ui";

export const metadata: Metadata = { title: "Review", robots: { index: false, follow: false } };

const KIND_TONE: Record<ReviewKind, "neutral" | "success" | "warning" | "info" | "danger"> = {
  held_answer: "info",
  escalated_claim: "warning",
  crm_stage_disagreement: "warning",
  rejected_proposal: "danger",
  crm_transition: "info",
};

/** Source addresses found in the evidence. Only https addresses become links; anything else is shown as text. */
function sourceUrls(evidence: Record<string, unknown>): string[] {
  const found = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "string") for (const m of v.matchAll(/https?:\/\/[^\s"'<>]+/g)) found.add(m[0]);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(evidence);
  return [...found].slice(0, 20);
}

export default async function ReviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const t = dict.commandCenter;
  const r = t.reviewUi;
  const messages = { ...formMessages(dict), ...r.msg };

  const state = await loadReview();
  if (state.status === "unauthorized") return <p className="text-sm text-rose-800">{r.msg.unauthorized}</p>;
  if (state.status !== "ok") return <LoadState kind={state.status} dict={dict} />;

  const { open, decided } = state;

  return (
    <>
      <p className="text-sm leading-relaxed text-navy-600">{r.hint}</p>
      <p className="text-sm leading-relaxed text-navy-600">{r.note}</p>

      <Panel title={r.openTitle}>
        {open.length === 0 ? (
          <p className="text-sm text-navy-600">{r.noOpen}</p>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            {open.map((item: ReviewItem) => (
              <article key={item.id} className="flex flex-col gap-4 rounded-2xl border border-navy-100 bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Badge tone={KIND_TONE[item.kind]}>{r.kind[item.kind]}</Badge>
                  <span className="text-xs text-navy-500">{r.expires}: {formatDateTime(item.expiresAt, locale)}</span>
                </div>
                <p className="text-sm leading-relaxed text-navy-900">{item.summary}</p>
                <dl className="grid gap-2 text-xs text-navy-700 sm:grid-cols-2">
                  <div><dt className="font-semibold">{r.agent}</dt><dd dir="ltr">{item.agent ?? "—"}</dd></div>
                  <div><dt className="font-semibold">{r.task}</dt><dd dir="ltr" className="font-mono">{item.taskId ?? "—"}</dd></div>
                  <div><dt className="font-semibold">{r.lead}</dt><dd dir="ltr" className="font-mono">{item.leadId ?? "—"}</dd></div>
                  <div><dt className="font-semibold">{r.created}</dt><dd>{formatDateTime(item.createdAt, locale)}</dd></div>
                </dl>
                {sourceUrls(item.evidence).length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-navy-800">{r.sources}</p>
                    <ul dir="ltr" className="mt-1 list-disc space-y-1 ps-5 text-xs break-all text-navy-700">
                      {sourceUrls(item.evidence).map((u) => (
                        <li key={u}>{u.startsWith("https://") ? <a href={u} target="_blank" rel="noopener noreferrer" className="underline">{u}</a> : u}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <details className="rounded-2xl bg-navy-50/60 p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-navy-800">{r.evidence}</summary>
                  <pre dir="ltr" className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-navy-800">
                    {JSON.stringify(item.evidence, null, 2).slice(0, 4000)}
                  </pre>
                </details>
                <ActionForm action={decideReviewAction} messages={messages} submitLabel={r.submit} pendingLabel={dict.common.loading} submitVariant="navy" resetOnSuccess className="grid gap-4 sm:grid-cols-2">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="itemId" value={item.id} />
                  <input type="hidden" name="expectedVersion" value={item.version} />
                  <SelectField
                    name="decision"
                    label={r.decisionField}
                    required
                    defaultValue={ALLOWED_DECISIONS[item.kind][0]}
                    options={ALLOWED_DECISIONS[item.kind].map((d) => ({ value: d, label: r.decision[d] }))}
                  />
                  <TextField name="reason" label={r.reasonField} required maxLength={500} />
                </ActionForm>
              </article>
            ))}
          </div>
        )}
      </Panel>

      <Panel title={r.historyTitle}>
        {decided.length === 0 ? (
          <p className="text-sm text-navy-600">{r.noHistory}</p>
        ) : (
          <DataTable head={[r.agent, r.task, r.decisionField, r.decidedBy, r.decidedAt]}>
            {decided.slice(0, 100).map((item) => (
              <tr key={item.id} className="align-top hover:bg-navy-50/50">
                <td className="px-4 py-3">
                  <p className="font-semibold text-navy-900">{r.kind[item.kind]}</p>
                  <p dir="ltr" className="text-xs text-navy-600">{item.agent ?? "—"}</p>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-navy-700" dir="ltr">{item.taskId ?? item.leadId ?? "—"}</td>
                <td className="px-4 py-3">
                  <p className="font-semibold text-navy-900">{r.status[item.status]}</p>
                  <p className="text-xs text-navy-600">{item.decisionReason ?? "—"}</p>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-navy-700" dir="ltr">{item.decidedBy ?? "—"}</td>
                <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(item.decidedAt, locale)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
    </>
  );
}
