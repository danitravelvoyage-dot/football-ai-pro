import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, formatDateTime, type Locale } from "@/lib/i18n";
import { formMessages } from "@/lib/validation/messages";
import { loadCampaigns } from "@/lib/ai/campaigns/load";
import { CAMPAIGN_STATUSES, OBJECTIVES, CURRENCIES, canMove, type CampaignStatus } from "@/lib/ai/campaigns/rules";
import { METRICS } from "@/lib/ai/memory/types";
import { AGENT_KEYS } from "@/lib/ai/types";
import { createCampaignAction, setCampaignStatusAction, assignToCampaignAction, recordSpendAction, recordKpiAction, archiveCampaignAction } from "@/lib/actions/campaigns";
import { ActionForm } from "@/components/forms/ActionForm";
import { SelectField, TextAreaField, TextField } from "@/components/forms/Fields";
import { DataTable, Panel } from "@/components/admin/AdminUI";
import { Fact, LoadState } from "@/components/admin/command-center/Parts";
import { Badge } from "@/components/ui";

export const metadata: Metadata = { title: "Campaigns", robots: { index: false, follow: false } };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const TONE: Record<CampaignStatus, "neutral" | "success" | "warning" | "info"> = { draft: "neutral", active: "success", paused: "warning", finished: "info" };

export default async function CampaignsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Search }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const c = dict.commandCenter.campaignsUi;
  const sp = await searchParams;
  const status = CAMPAIGN_STATUSES.find((s) => s === one(sp.status));
  const includeArchived = one(sp.archived) === "1";
  const selectedId = one(sp.id);

  const state = await loadCampaigns({ status, includeArchived, selectedId });
  if (state.status === "unauthorized") return <p className="text-sm text-rose-800">{c.unauthorized}</p>;
  if (state.status !== "ok") return <LoadState kind={state.status} dict={dict} />;

  const messages = { ...formMessages(dict), saved: c.saved, forbidden: c.errorForbidden, invalid_input: c.errorInvalid, rule_refused: c.errorRule, unauthorized: c.errorUnauthorized, generic: c.errorGeneric };
  const money = (minor: number, currency: string) => `${(minor / 100).toLocaleString(locale)} ${currency}`;
  const sel = state.selected;

  return (
    <>
      <p className="text-sm leading-relaxed text-navy-600">{c.hint}</p>

      <Panel title={c.listTitle}>
        <form method="get" className="mb-4 grid gap-4 sm:grid-cols-3">
          <SelectField name="status" label={c.status} defaultValue={status ?? ""} options={[{ value: "", label: c.all }, ...CAMPAIGN_STATUSES.map((s) => ({ value: s, label: c.statusLabels[s] }))]} />
          <label className="flex items-center gap-2 text-sm text-navy-800">
            <input type="checkbox" name="archived" value="1" defaultChecked={includeArchived} className="h-4 w-4" />
            {c.showArchived}
          </label>
          <div>
            <button type="submit" className="rounded-full bg-navy-900 px-5 py-2 text-sm font-semibold text-white">{c.apply}</button>
          </div>
        </form>
        {state.campaigns.length === 0 ? (
          <p className="text-sm text-navy-600">{c.empty}</p>
        ) : (
          <DataTable head={[c.name, c.status, c.objective, c.budget, c.updated, ""]}>
            {state.campaigns.map((r) => (
              <tr key={r.id} className="align-top hover:bg-navy-50/50">
                <td className="px-4 py-3 text-sm font-semibold text-navy-900">{r.name}{r.archivedAt ? <span className="ms-2 text-xs text-navy-500">({c.archived})</span> : null}</td>
                <td className="px-4 py-3"><Badge tone={TONE[r.status]}>{c.statusLabels[r.status]}</Badge></td>
                <td className="px-4 py-3 text-sm text-navy-800">{c.objectives[r.objective]}</td>
                <td className="px-4 py-3 text-sm text-navy-800">{money(r.budgetMinor, r.currency)}</td>
                <td className="px-4 py-3 text-sm text-navy-800">{formatDateTime(r.updatedAt, locale)}</td>
                <td className="px-4 py-3"><a href={`?id=${r.id}`} className="text-sm font-semibold text-navy-800 underline">{c.open}</a></td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      {sel ? (
        <>
          <Panel title={sel.campaign.name}>
            <p className="mb-4 text-sm leading-relaxed text-navy-700">{sel.campaign.goal}</p>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Fact label={c.status} value={c.statusLabels[sel.campaign.status]} />
              <Fact label={c.objective} value={c.objectives[sel.campaign.objective]} />
              <Fact label={c.budget} value={money(sel.budget.budgetMinor, sel.campaign.currency)} />
              <Fact label={c.spent} value={`${money(sel.budget.spentMinor, sel.campaign.currency)}${sel.budget.percentSpent === null ? "" : ` (${sel.budget.percentSpent}%)`}`} />
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              {CAMPAIGN_STATUSES.filter((to) => canMove(sel.campaign.status, to)).map((to) => (
                <ActionForm key={to} action={setCampaignStatusAction} messages={messages} submitLabel={`${c.moveTo} ${c.statusLabels[to]}`} pendingLabel={dict.common.loading} submitVariant="navy">
                  <input type="hidden" name="id" value={sel.campaign.id} />
                  <input type="hidden" name="to" value={to} />
                </ActionForm>
              ))}
              {sel.campaign.archivedAt ? null : (
                <ActionForm action={archiveCampaignAction} messages={messages} submitLabel={c.archive} pendingLabel={dict.common.loading} submitVariant="navy" confirmMessage={c.archiveConfirm}>
                  <input type="hidden" name="id" value={sel.campaign.id} />
                </ActionForm>
              )}
            </div>
          </Panel>

          <Panel title={c.kpis}>
            {sel.kpis.length === 0 ? <p className="text-sm text-navy-600">{c.noKpis}</p> : (
              <DataTable head={[c.metric, c.target, c.actual, c.progress]}>
                {sel.kpis.map((k) => (
                  <tr key={k.metric} className="hover:bg-navy-50/50">
                    <td className="px-4 py-3 font-mono text-xs text-navy-800" dir="ltr">{k.metric}</td>
                    <td className="px-4 py-3 text-sm text-navy-800">{k.target}</td>
                    <td className="px-4 py-3 text-sm text-navy-800">{k.actual ?? c.noReading}</td>
                    <td className="px-4 py-3 text-sm text-navy-800">{k.percent === null ? "—" : `${k.percent}%`}</td>
                  </tr>
                ))}
              </DataTable>
            )}
            <ActionForm action={recordKpiAction} messages={messages} submitLabel={c.recordKpi} pendingLabel={dict.common.loading} submitVariant="navy" resetOnSuccess className="mt-4 grid gap-4 sm:grid-cols-3">
              <input type="hidden" name="id" value={sel.campaign.id} />
              <SelectField name="metric" label={c.metric} required defaultValue={sel.kpis[0]?.metric ?? ""} options={sel.kpis.map((k) => ({ value: k.metric, label: k.metric }))} />
              <TextField name="value" label={c.value} type="number" min="0" required />
              <TextField name="period" label={c.period} required maxLength={40} />
            </ActionForm>
          </Panel>

          <Panel title={c.team}>
            <p className="mb-3 text-sm text-navy-700">{sel.campaign.agents.length === 0 ? c.noTeam : sel.campaign.agents.join(", ")}</p>
            <ActionForm action={assignToCampaignAction} messages={messages} submitLabel={c.assignAgent} pendingLabel={dict.common.loading} submitVariant="navy" className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="id" value={sel.campaign.id} />
              <input type="hidden" name="kind" value="agent" />
              <SelectField name="value" label={c.agent} required options={AGENT_KEYS.filter((a) => !sel.campaign.agents.includes(a)).map((a) => ({ value: a, label: a }))} />
            </ActionForm>
          </Panel>

          <Panel title={c.contentTitle}>
            <p className="mb-3 text-sm text-navy-700">{sel.campaign.contentIds.length === 0 ? c.noContent : `${sel.campaign.contentIds.length} ${c.items}`}</p>
            {state.pipeline.length > 0 ? (
              <ActionForm action={assignToCampaignAction} messages={messages} submitLabel={c.assignContent} pendingLabel={dict.common.loading} submitVariant="navy" className="grid gap-4 sm:grid-cols-2">
                <input type="hidden" name="id" value={sel.campaign.id} />
                <input type="hidden" name="kind" value="content" />
                <SelectField name="value" label={c.contentItem} required options={state.pipeline.filter((p) => !sel.campaign.contentIds.includes(p.id)).map((p) => ({ value: p.id, label: `${p.kind} · ${p.status}` }))} />
              </ActionForm>
            ) : null}
          </Panel>

          <Panel title={c.spendTitle}>
            <ActionForm action={recordSpendAction} messages={messages} submitLabel={c.recordSpend} pendingLabel={dict.common.loading} submitVariant="navy" resetOnSuccess className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="id" value={sel.campaign.id} />
              <TextField name="amount" label={`${c.amount} (${sel.campaign.currency})`} type="number" min="0.01" required />
              <TextField name="note" label={c.note} required maxLength={200} />
            </ActionForm>
          </Panel>

          <Panel title={c.history}>
            {sel.events.length === 0 ? <p className="text-sm text-navy-600">{c.noHistory}</p> : (
              <DataTable head={[c.when, c.event, c.by]}>
                {sel.events.map((e) => (
                  <tr key={e.id} className="hover:bg-navy-50/50">
                    <td className="px-4 py-3 text-sm text-navy-800">{formatDateTime(e.at, locale)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-navy-800" dir="ltr">{e.type}</td>
                    <td className="px-4 py-3 font-mono text-xs text-navy-700" dir="ltr">{e.by}</td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Panel>
        </>
      ) : null}

      <Panel title={c.createTitle}>
        <ActionForm action={createCampaignAction} messages={messages} submitLabel={c.create} pendingLabel={dict.common.loading} submitVariant="navy" resetOnSuccess className="grid gap-4 sm:grid-cols-2">
          <TextField name="name" label={c.name} required maxLength={120} />
          <TextField name="channel" label={c.channel} required maxLength={60} />
          <TextAreaField name="goal" label={c.goal} required maxLength={500} rows={3} />
          <SelectField name="objective" label={c.objective} required defaultValue="leads" options={OBJECTIVES.map((o) => ({ value: o, label: c.objectives[o] }))} />
          <SelectField name="kpiMetric" label={c.metric} required defaultValue="leads" options={METRICS.map((m) => ({ value: m, label: m }))} />
          <TextField name="kpiTarget" label={c.target} type="number" min="0.01" required />
          <TextField name="budget" label={c.budgetInput} type="number" min="0" required />
          <SelectField name="currency" label={c.currency} required defaultValue="DZD" options={CURRENCIES.map((x) => ({ value: x, label: x }))} />
          <SelectField name="country" label={c.country} required defaultValue="dz" options={["dz", "ma", "tn", "all"].map((x) => ({ value: x, label: x }))} />
          <SelectField name="language" label={c.language} required defaultValue={locale} options={["ar", "fr", "en"].map((x) => ({ value: x, label: x }))} />
          <TextField name="startsOn" label={c.startsOn} type="date" />
          <TextField name="endsOn" label={c.endsOn} type="date" />
        </ActionForm>
        <p className="mt-3 text-xs text-navy-500">{c.objectiveHint}</p>
      </Panel>
    </>
  );
}
