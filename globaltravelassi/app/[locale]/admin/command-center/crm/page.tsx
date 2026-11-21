import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, formatDateTime, type Locale } from "@/lib/i18n";
import { formMessages } from "@/lib/validation/messages";
import { loadCrm } from "@/lib/ai/crm/load";
import { LEAD_STAGES, LEAD_SOURCES, INTERESTS, INTERACTION_KINDS, type LeadStage } from "@/lib/ai/crm/rules";
import { createLeadAction, changeLeadStageAction, addLeadInteractionAction, proposeFollowUpsAction, decideFollowUpAction } from "@/lib/actions/crm";
import { ActionForm } from "@/components/forms/ActionForm";
import { SelectField, TextAreaField, TextField } from "@/components/forms/Fields";
import { DataTable, Panel } from "@/components/admin/AdminUI";
import { Fact, LoadState } from "@/components/admin/command-center/Parts";
import { Badge } from "@/components/ui";

export const metadata: Metadata = { title: "CRM", robots: { index: false, follow: false } };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const STAGE_TONE: Record<LeadStage, "neutral" | "success" | "warning" | "info" | "danger"> = {
  new: "neutral",
  contacted: "info",
  qualified: "info",
  interested: "warning",
  converted: "success",
  lost: "danger",
};

export default async function CrmPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Search }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const c = dict.commandCenter.crmUi;
  const sp = await searchParams;
  const stage = LEAD_STAGES.find((s) => s === one(sp.stage));
  const includeArchived = one(sp.archived) === "1";
  const selectedId = one(sp.id);

  const state = await loadCrm({ stage, includeArchived, selectedId });
  if (state.status === "unauthorized") return <p className="text-sm text-rose-800">{c.unauthorized}</p>;
  if (state.status !== "ok") return <LoadState kind={state.status} dict={dict} />;

  const messages = { ...formMessages(dict), saved: c.saved, forbidden: c.errorForbidden, invalid_input: c.errorInvalid, rule_refused: c.errorRule, unauthorized: c.errorUnauthorized, generic: c.errorGeneric, stale: c.errorStale, pending_owner: c.pendingOwner };
  const sel = state.selected;
  const money = (n: number | null) => (n === null ? "—" : `${n}%`);
  const reasonText = (code: string) => (c.reasonLabels as Record<string, string>)[code] ?? code;

  return (
    <>
      <p className="text-sm leading-relaxed text-navy-600">{c.hint}</p>

      <Panel title={c.funnelTitle}>
        <p className="mb-4 text-sm text-navy-600">{c.funnelHint}</p>
        {state.funnel.rows[0]?.reached === 0 ? (
          <p className="text-sm text-navy-600">{c.noData}</p>
        ) : (
          <>
            <dl className="mb-4 grid gap-4 sm:grid-cols-3">
              <Fact label={c.conversion} value={money(state.funnel.conversionRate)} />
              <Fact label={c.activeCount} value={String(state.funnel.activeCount)} />
              <Fact label={c.lostCount} value={String(state.funnel.lostCount)} />
            </dl>
            <DataTable head={[c.stage, c.reached, "%"]}>
              {state.funnel.rows.map((r) => (
                <tr key={r.stage} className="hover:bg-navy-50/50">
                  <td className="px-4 py-3"><Badge tone={STAGE_TONE[r.stage]}>{c.stageLabels[r.stage]}</Badge></td>
                  <td className="px-4 py-3 text-sm text-navy-800">{r.reached}</td>
                  <td className="px-4 py-3 text-sm text-navy-800">{money(r.rate)}</td>
                </tr>
              ))}
            </DataTable>
          </>
        )}
      </Panel>

      <Panel title={c.listTitle}>
        <form method="get" className="mb-4 grid gap-4 sm:grid-cols-3">
          <SelectField name="stage" label={c.stage} defaultValue={stage ?? ""} options={[{ value: "", label: c.all }, ...LEAD_STAGES.map((s) => ({ value: s, label: c.stageLabels[s] }))]} />
          <label className="flex items-center gap-2 text-sm text-navy-800">
            <input type="checkbox" name="archived" value="1" defaultChecked={includeArchived} className="h-4 w-4" />
            {dict.commandCenter.campaignsUi.showArchived}
          </label>
          <div>
            <button type="submit" className="rounded-full bg-navy-900 px-5 py-2 text-sm font-semibold text-white">{dict.commandCenter.campaignsUi.apply}</button>
          </div>
        </form>
        {state.leads.length === 0 ? (
          <p className="text-sm text-navy-600">{c.empty}</p>
        ) : (
          <DataTable head={[c.label, c.stage, c.source, c.score, c.intent, c.idle, ""]}>
            {state.leads.map((item) => (
              <tr key={item.lead.id} className="align-top hover:bg-navy-50/50">
                <td className="px-4 py-3 text-sm font-semibold text-navy-900">{item.lead.label}</td>
                <td className="px-4 py-3"><Badge tone={STAGE_TONE[item.lead.stage]}>{c.stageLabels[item.lead.stage]}</Badge></td>
                <td className="px-4 py-3 text-sm text-navy-800">{c.sourceLabels[item.lead.source]}</td>
                <td className="px-4 py-3 text-sm text-navy-800">{item.assessment.score}</td>
                <td className="px-4 py-3 text-sm text-navy-800">{c.intentLabels[item.assessment.intent]}</td>
                <td className="px-4 py-3 text-sm text-navy-800">{item.assessment.idleDays}</td>
                <td className="px-4 py-3"><a href={`?id=${item.lead.id}`} className="text-sm font-semibold text-navy-800 underline">{c.open}</a></td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <Panel title={c.createTitle}>
        <ActionForm action={createLeadAction} messages={messages} submitLabel={c.createLead} pendingLabel={dict.common.loading} submitVariant="navy" resetOnSuccess className="grid gap-4 sm:grid-cols-2">
          <TextField name="label" label={c.labelField} required maxLength={120} />
          <SelectField name="source" label={c.sourceField} required defaultValue="manual" options={LEAD_SOURCES.map((s) => ({ value: s, label: c.sourceLabels[s] }))} />
          <div className="sm:col-span-2">
            <TextField name="applicationId" label={c.applicationId} />
            <p className="mt-1 text-xs text-navy-600">{c.applicationHint}</p>
          </div>
          <TextField name="destinationCountry" label={c.destination} maxLength={2} />
          <TextField name="nationality" label={c.nationality} maxLength={2} />
          <TextField name="travelDate" label={c.travelDate} type="date" />
          <SelectField name="interest" label={c.interest} required defaultValue="other" options={INTERESTS.map((i) => ({ value: i, label: c.interestLabels[i] }))} />
        </ActionForm>
      </Panel>

      {sel ? (
        <>
          <Panel title={`${c.detailTitle}: ${sel.lead.label}`}>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Fact label={c.stage} value={c.stageLabels[sel.lead.stage]} />
              <Fact label={c.source} value={c.sourceLabels[sel.lead.source]} />
              <Fact label={c.score} value={String(sel.assessment.score)} />
              <Fact label={c.intent} value={c.intentLabels[sel.assessment.intent]} />
            </dl>
            <h3 className="mt-6 text-sm font-semibold text-navy-900">{c.reasonsTitle}</h3>
            {sel.assessment.reasons.length === 0 ? (
              <p className="mt-2 text-sm text-navy-600">{c.noReasons}</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm text-navy-800">
                {sel.assessment.reasons.map((r) => (
                  <li key={r.code}>{reasonText(r.code)}: {r.points > 0 ? `+${r.points}` : r.points}</li>
                ))}
              </ul>
            )}

            <h3 className="mt-6 text-sm font-semibold text-navy-900">{c.stageTitle}</h3>
            {sel.allowedMoves.length === 0 ? (
              <p className="mt-2 text-sm text-navy-600">{c.closedLead}</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-3">
                {sel.allowedMoves.map((to) => (
                  <ActionForm key={to} action={changeLeadStageAction} messages={messages} submitLabel={`${c.moveTo} ${c.stageLabels[to]}`} pendingLabel={dict.common.loading} submitVariant="navy" className={to === "lost" ? "w-full" : undefined}>
                    <input type="hidden" name="id" value={sel.lead.id} />
                    <input type="hidden" name="to" value={to} />
                    <input type="hidden" name="expectedVersion" value={sel.lead.version} />
                    {to === "lost" ? <TextField name="reason" label={c.reason} required maxLength={300} /> : null}
                  </ActionForm>
                ))}
              </div>
            )}
          </Panel>

          <Panel title={c.interactionTitle}>
            <ActionForm action={addLeadInteractionAction} messages={messages} submitLabel={c.recordInteraction} pendingLabel={dict.common.loading} submitVariant="navy" resetOnSuccess className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="id" value={sel.lead.id} />
              <SelectField name="kind" label={c.kind} required defaultValue="note" options={INTERACTION_KINDS.map((k) => ({ value: k, label: c.kindLabels[k] }))} />
              <div className="sm:col-span-2">
                <TextAreaField name="summary" label={c.summary} required maxLength={1000} rows={3} />
                <p className="mt-1 text-xs text-navy-600">{c.summaryHint}</p>
              </div>
            </ActionForm>
            <h3 className="mt-6 text-sm font-semibold text-navy-900">{c.interactionsTitle}</h3>
            {sel.interactions.length === 0 ? (
              <p className="mt-2 text-sm text-navy-600">{c.noInteractions}</p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm text-navy-800">
                {sel.interactions.map((i) => (
                  <li key={i.id}><span className="font-semibold">{c.kindLabels[i.kind]}</span> · {formatDateTime(i.occurredAt, locale)}: {i.summary}</li>
                ))}
              </ul>
            )}
            <h3 className="mt-6 text-sm font-semibold text-navy-900">{c.historyTitle}</h3>
            {sel.history.length === 0 ? (
              <p className="mt-2 text-sm text-navy-600">{c.noHistory}</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm text-navy-800">
                {sel.history.map((h) => (
                  <li key={h.id}>{c.stageLabels[h.fromStage]} → {c.stageLabels[h.toStage]} · {formatDateTime(h.changedAt, locale)}{h.reason ? ` · ${h.reason}` : ""}</li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      ) : null}

      <Panel title={c.followUpTitle}>
        <ActionForm action={proposeFollowUpsAction} messages={messages} submitLabel={c.proposeFollowUps} pendingLabel={dict.common.loading} submitVariant="navy">
          <></>
        </ActionForm>
        <div className="mt-4">
          {state.followUps.length === 0 ? (
            <p className="text-sm text-navy-600">{c.noFollowUps}</p>
          ) : (
            <DataTable head={[c.reason, c.priority, c.stage, c.due, ""]}>
              {state.followUps.map((f) => (
                <tr key={f.id} className="align-top hover:bg-navy-50/50">
                  <td className="px-4 py-3 text-sm text-navy-800">{reasonText(f.reason)}</td>
                  <td className="px-4 py-3 text-sm text-navy-800">{c.priorityLabels[f.priority]}</td>
                  <td className="px-4 py-3 text-sm text-navy-800">{c.followUpStatusLabels[f.status]}</td>
                  <td className="px-4 py-3 text-sm text-navy-800">{formatDateTime(f.dueAt, locale)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {f.status === "suggested" ? (
                        <>
                          <ActionForm action={decideFollowUpAction} messages={messages} submitLabel={c.approve} pendingLabel={dict.common.loading} submitVariant="navy">
                            <input type="hidden" name="id" value={f.id} />
                            <input type="hidden" name="decision" value="approve" />
                          </ActionForm>
                          <ActionForm action={decideFollowUpAction} messages={messages} submitLabel={c.dismiss} pendingLabel={dict.common.loading} submitVariant="navy">
                            <input type="hidden" name="id" value={f.id} />
                            <input type="hidden" name="decision" value="dismiss" />
                          </ActionForm>
                        </>
                      ) : null}
                      {f.status === "scheduled" ? (
                        <ActionForm action={decideFollowUpAction} messages={messages} submitLabel={c.complete} pendingLabel={dict.common.loading} submitVariant="navy">
                          <input type="hidden" name="id" value={f.id} />
                          <input type="hidden" name="decision" value="complete" />
                        </ActionForm>
                      ) : null}
                      <a href={`?id=${f.leadId}`} className="self-center text-sm font-semibold text-navy-800 underline">{c.lead}</a>
                    </div>
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </div>
      </Panel>
    </>
  );
}
