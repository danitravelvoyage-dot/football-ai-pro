"use server";

import { revalidatePath } from "next/cache";
import { createAiServices } from "@/lib/ai/services";
import { CrmForbiddenError, CrmRuleError, CrmRequiresApprovalError, CrmStaleError, CrmValidationError } from "@/lib/ai/crm/service";
import { ownerId } from "./ai";
import { formObject, localeFrom } from "./helpers";
import type { ActionState } from "./types";
import { z } from "zod";

function failure(error: unknown): ActionState {
  if (error instanceof CrmStaleError) return { ok: false, code: "stale" };
  if (error instanceof CrmForbiddenError) return { ok: false, code: "forbidden" };
  if (error instanceof CrmValidationError) return { ok: false, code: "invalid_input" };
  if (error instanceof CrmRuleError) return { ok: false, code: "rule_refused" };
  return { ok: false, code: "generic" };
}

const refresh = (locale: string) => revalidatePath(`/${locale}/admin/command-center`, "layout");
const idSchema = z.string().uuid();

/** Owner only. Creates a lead. The form never sends contact details: application leads are linked by id. */
export async function createLeadAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };
  const f = formObject(formData);
  try {
    const services = await createAiServices();
    const lead = await services.crm.createLead(
      { kind: "owner", id: owner },
      {
        label: f.label ?? "",
        source: f.source ?? "",
        applicationId: f.applicationId ? f.applicationId : null,
        destinationCountry: f.destinationCountry ? f.destinationCountry.toUpperCase() : null,
        nationality: f.nationality ? f.nationality.toUpperCase() : null,
        travelDate: f.travelDate ? f.travelDate : null,
        interest: f.interest ?? "",
      },
    );
    refresh(locale);
    return { ok: true, code: "saved", id: lead.id };
  } catch (error) {
    return failure(error);
  }
}

/** Owner only. Moves a lead along the pipeline. The pipeline rules are checked here and again in the database. */
export async function changeLeadStageAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };
  const f = formObject(formData);
  const id = idSchema.safeParse(f.id);
  const expectedVersion = Number(f.expectedVersion);
  if (!id.success || !Number.isInteger(expectedVersion) || expectedVersion < 1) return { ok: false, code: "invalid_input" };
  try {
    const services = await createAiServices();
    const result = await services.crm.requestStageChange({ kind: "owner", id: owner }, id.data, {
      to: f.to ?? "",
      reason: f.reason ? f.reason : null,
      expectedVersion,
    });
    refresh(locale);
    return result.status === "applied" ? { ok: true, code: "saved" } : { ok: true, code: "pending_owner", id: result.reviewId };
  } catch (error) {
    if (error instanceof CrmRequiresApprovalError) return { ok: true, code: "pending_owner", id: error.reviewId };
    return failure(error);
  }
}

/** Owner only. Records an interaction the owner had with the lead, outside the platform. */
export async function addLeadInteractionAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };
  const f = formObject(formData);
  const id = idSchema.safeParse(f.id);
  if (!id.success) return { ok: false, code: "invalid_input" };
  try {
    const services = await createAiServices();
    await services.crm.addInteraction({ kind: "owner", id: owner }, id.data, { kind: f.kind ?? "", summary: f.summary ?? "" });
    refresh(locale);
    return { ok: true, code: "saved" };
  } catch (error) {
    return failure(error);
  }
}

/** Owner only. Proposes follow-ups for quiet leads. Proposals are not sent to anyone. */
export async function proposeFollowUpsAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };
  try {
    const services = await createAiServices();
    await services.crm.proposeFollowUps({ kind: "owner", id: owner });
    refresh(locale);
    return { ok: true, code: "saved" };
  } catch (error) {
    return failure(error);
  }
}

/** Owner only. Approves, dismisses or completes a follow-up. Approval schedules it for the owner. It does not message the customer. */
export async function decideFollowUpAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };
  const f = formObject(formData);
  const id = idSchema.safeParse(f.id);
  if (!id.success) return { ok: false, code: "invalid_input" };
  if (f.decision !== "approve" && f.decision !== "dismiss" && f.decision !== "complete") return { ok: false, code: "invalid_input" };
  try {
    const services = await createAiServices();
    await services.crm.decideFollowUp({ kind: "owner", id: owner }, id.data, f.decision);
    refresh(locale);
    return { ok: true, code: "saved" };
  } catch (error) {
    return failure(error);
  }
}
