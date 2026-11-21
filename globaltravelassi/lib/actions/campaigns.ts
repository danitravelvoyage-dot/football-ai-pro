"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAiServices } from "@/lib/ai/services";
import { CampaignForbiddenError, CampaignRuleError, CampaignValidationError } from "@/lib/ai/campaigns/service";
import { CAMPAIGN_STATUSES } from "@/lib/ai/campaigns/rules";
import { ContentInputError } from "@/lib/ai/content/review";
import { ownerId } from "./ai";
import { formObject, localeFrom, parseWith } from "./helpers";
import type { ActionState } from "./types";

const idSchema = z.string().uuid();

function failure(error: unknown): ActionState {
  if (error instanceof CampaignForbiddenError) return { ok: false, code: "forbidden" };
  if (error instanceof CampaignValidationError || error instanceof ContentInputError) return { ok: false, code: "invalid_input" };
  if (error instanceof CampaignRuleError) return { ok: false, code: "rule_refused" };
  return { ok: false, code: "generic" };
}

const refresh = (locale: string) => revalidatePath(`/${locale}/admin/command-center`, "layout");
const major = (v: string) => Math.round(Number(v) * 100);

/** Owner only. Creates a draft campaign from the form. Money is entered in major units and stored in minor units. */
export async function createCampaignAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };
  const f = formObject(formData);
  const input = {
    name: f.name ?? "",
    goal: f.goal ?? "",
    objective: f.objective ?? "",
    kpis: [{ metric: f.kpiMetric ?? "", target: Number(f.kpiTarget) }],
    budgetMinor: Number.isFinite(Number(f.budget)) ? major(f.budget ?? "0") : NaN,
    currency: f.currency ?? "",
    channel: f.channel ?? "",
    country: f.country ?? "",
    language: f.language ?? "",
    startsOn: f.startsOn ? f.startsOn : null,
    endsOn: f.endsOn ? f.endsOn : null,
  };
  try {
    const services = await createAiServices();
    const created = await services.campaigns.create({ kind: "owner", id: owner }, input);
    refresh(locale);
    return { ok: true, code: "saved", id: created.id };
  } catch (error) {
    return failure(error);
  }
}

/** Owner only. Runs one lifecycle move. Launch is refused until the team is set and the content is approved. */
export async function setCampaignStatusAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };
  const id = parseWith(z.object({ id: idSchema, to: z.enum(CAMPAIGN_STATUSES) }), { id: formData.get("id"), to: formData.get("to") });
  if (!id.ok) return id.state;
  try {
    const services = await createAiServices();
    await services.campaigns.transition({ kind: "owner", id: owner }, id.data.id, id.data.to);
    refresh(locale);
    return { ok: true, code: "saved" };
  } catch (error) {
    return failure(error);
  }
}

/** Owner only. Assigns an agent to the campaign's team, or assigns a content item from the pipeline. */
export async function assignToCampaignAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };
  const parsed = parseWith(z.object({ id: idSchema, kind: z.enum(["agent", "content"]), value: z.string().min(1).max(80) }), {
    id: formData.get("id"),
    kind: formData.get("kind"),
    value: formData.get("value"),
  });
  if (!parsed.ok) return parsed.state;
  try {
    const services = await createAiServices();
    const actor = { kind: "owner" as const, id: owner };
    if (parsed.data.kind === "agent") await services.campaigns.assignAgent(actor, parsed.data.id, parsed.data.value);
    else await services.campaigns.assignContent(actor, parsed.data.id, parsed.data.value);
    refresh(locale);
    return { ok: true, code: "saved" };
  } catch (error) {
    return failure(error);
  }
}

/** Owner only. Records spend (major units in the form) against the campaign budget. */
export async function recordSpendAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };
  const f = formObject(formData);
  try {
    const services = await createAiServices();
    await services.campaigns.addSpend({ kind: "owner", id: owner }, f.id ?? "", { amountMinor: major(f.amount ?? "0"), note: f.note ?? "" });
    refresh(locale);
    return { ok: true, code: "saved" };
  } catch (error) {
    return failure(error);
  }
}

/** Owner only. Records a KPI reading for one of the campaign's KPIs. */
export async function recordKpiAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };
  const f = formObject(formData);
  try {
    const services = await createAiServices();
    await services.campaigns.recordKpi({ kind: "owner", id: owner }, f.id ?? "", { metric: f.metric ?? "", value: Number(f.value), period: f.period ?? "" });
    refresh(locale);
    return { ok: true, code: "saved" };
  } catch (error) {
    return failure(error);
  }
}

/** Owner only. Archives a campaign that is not running. */
export async function archiveCampaignAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };
  try {
    const services = await createAiServices();
    await services.campaigns.archive({ kind: "owner", id: owner }, String(formData.get("id") ?? ""));
    refresh(locale);
    return { ok: true, code: "saved" };
  } catch (error) {
    return failure(error);
  }
}

/** Owner only. Approves, rejects or requests a revision of a content item. A revision sends the note to the writing agent. */
export async function decideContentAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };
  const parsed = parseWith(z.object({ id: idSchema, decision: z.enum(["approved", "rejected", "revision_requested"]), note: z.string().max(1000) }), {
    id: formData.get("id"),
    decision: formData.get("decision"),
    note: String(formData.get("note") ?? ""),
  });
  if (!parsed.ok) return parsed.state;
  try {
    const services = await createAiServices();
    await services.content.decide({ kind: "owner", id: owner }, parsed.data.id, parsed.data.decision, parsed.data.note || null);
    refresh(locale);
    return { ok: true, code: "saved" };
  } catch (error) {
    return failure(error);
  }
}
