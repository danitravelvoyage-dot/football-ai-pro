import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, formatDateTime, type Locale } from "@/lib/i18n";
import { formMessages } from "@/lib/validation/messages";
import { loadCollaboration } from "@/lib/ai/collaboration/load";
import { resolveConflictAction } from "@/lib/actions/collaboration";
import { ActionForm } from "@/components/forms/ActionForm";
import { TextAreaField } from "@/components/forms/Fields";
import { DataTable, Panel } from "@/components/admin/AdminUI";
import { Fact, LoadState } from "@/components/admin/command-center/Parts";
import { Badge } from "@/components/ui";

export const metadata: Metadata = { title: "Conflicts and reviews", robots: { index: false, follow: false } };

export default async function ConflictsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const c = dict.commandCenter.collabUi;

  const state = await loadCollaboration();
  if (state.status === "unauthorized") return <p className="text-sm text-rose-800">{c.unauthorized}</p>;
  if (state.status !== "ok") return <LoadState kind={state.status} dict={dict} />;

  const messages = { ...formMessages(dict), saved: c.saved, forbidden: c.errorForbidden, invalid_input: c.errorInvalid, rule_refused: c.errorRule, not_found: c.notFound, unauthorized: c.errorUnauthorized, generic: c.errorGeneric };
  const base = `/${locale}/admin/command-center`;

  return (
    <>
      <p className="text-sm leading-relaxed text-navy-600">{c.hint}</p>

      <Panel title={c.pendingHolds}>
        <div className="flex flex-wrap items-center gap-4">
          <Fact label={c.pendingHolds} value={String(state.pendingHolds)} />
          <Link href={`${base}/approvals`} className="text-sm font-semibold text-navy-800 underline">{c.openApprovals}</Link>
        </div>
        <p className="mt-2 text-sm text-navy-600">{c.pendingHoldsHint}</p>
      </Panel>

      <Panel title={c.openConflicts}>
        {state.openConflicts.length === 0 ? (
          <p className="text-sm text-navy-600">{c.noOpen}</p>
        ) : (
          <div className="space-y-6">
            {state.openConflicts.map((conflict) => (
              <div key={conflict.id} className="rounded-2xl border border-navy-100 p-4">
                <p className="text-sm text-navy-800"><span className="font-semibold">{c.parties}:</span> <span dir="ltr">{conflict.parties.join(", ")}</span></p>
                <p className="mt-1 text-sm text-navy-800"><span className="font-semibold">{c.codes}:</span> <span dir="ltr">{conflict.codes.join(", ")}</span></p>
                <p className="mt-1 text-xs text-navy-600" dir="ltr">{conflict.subjectKey} · {formatDateTime(conflict.detectedAt, locale)}</p>
                <ActionForm action={resolveConflictAction} messages={messages} submitLabel={c.resolve} pendingLabel={dict.common.loading} submitVariant="navy" resetOnSuccess className="mt-4 grid gap-4">
                  <input type="hidden" name="id" value={conflict.id} />
                  <div>
                    <TextAreaField name="resolution" label={c.resolution} required maxLength={500} rows={2} />
                    <p className="mt-1 text-xs text-navy-600">{c.resolutionHint}</p>
                  </div>
                </ActionForm>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title={c.resolvedConflicts}>
        {state.resolvedConflicts.length === 0 ? (
          <p className="text-sm text-navy-600">{c.noResolved}</p>
        ) : (
          <DataTable head={[c.parties, c.resolution, c.resolvedBy, c.detected]}>
            {state.resolvedConflicts.map((conflict) => (
              <tr key={conflict.id} className="align-top hover:bg-navy-50/50">
                <td className="px-4 py-3 text-sm text-navy-800" dir="ltr">{conflict.parties.join(", ")}</td>
                <td className="px-4 py-3 text-sm text-navy-800">{conflict.resolution}</td>
                <td className="px-4 py-3"><Badge tone="success">{c.resolvedBy}</Badge></td>
                <td className="px-4 py-3 text-sm text-navy-800">{formatDateTime(conflict.detectedAt, locale)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <Panel title={c.reviewerDecisions}>
        {state.panels.length === 0 ? (
          <p className="text-sm text-navy-600">{c.noPanels}</p>
        ) : (
          <DataTable head={[c.producer, c.status, c.decision, c.counted, c.excluded, c.reasons, c.disagreement]}>
            {state.panels.map((p) => (
              <tr key={p.id} className="align-top hover:bg-navy-50/50">
                <td className="px-4 py-3 text-sm text-navy-800" dir="ltr">{p.producer}</td>
                <td className="px-4 py-3 text-sm text-navy-800" dir="ltr">{p.status}</td>
                <td className="px-4 py-3 text-sm text-navy-800">{c.decisionLabels[p.decision]}</td>
                <td className="px-4 py-3 text-xs text-navy-800" dir="ltr">
                  {p.votes.map((v) => `${v.reviewer}: ${c.verdictLabels[v.verdict]}`).join(" · ")}
                </td>
                <td className="px-4 py-3 text-xs text-navy-800" dir="ltr">{p.excluded.map((e) => `${e.reviewer} (${e.reason})`).join(", ") || "—"}</td>
                <td className="px-4 py-3 text-xs text-navy-800" dir="ltr">{p.reasons.join(", ")}</td>
                <td className="px-4 py-3 text-sm text-navy-800">{p.disagreement ? c.yes : c.no}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <Panel title={c.routingDecisions}>
        {state.routing.length === 0 ? (
          <p className="text-sm text-navy-600">{c.noRouting}</p>
        ) : (
          <DataTable head={[c.step, c.capability, c.templateAgent, c.chosenAgent, c.reasons]}>
            {state.routing.map((r) => (
              <tr key={r.id} className="align-top hover:bg-navy-50/50">
                <td className="px-4 py-3 font-mono text-xs text-navy-800" dir="ltr">{r.stepKey}</td>
                <td className="px-4 py-3 text-xs text-navy-800" dir="ltr">{r.capability}</td>
                <td className="px-4 py-3 text-xs text-navy-800" dir="ltr">{r.templateAgent}</td>
                <td className="px-4 py-3 text-xs font-semibold text-navy-900" dir="ltr">{r.chosenAgent}</td>
                <td className="px-4 py-3 text-xs text-navy-800" dir="ltr">{r.reasons.join(", ")}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
    </>
  );
}
