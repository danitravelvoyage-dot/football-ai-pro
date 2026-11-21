"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAiServices } from "@/lib/ai/services";
import { ReviewForbiddenError, ReviewRuleError } from "@/lib/ai/review/service";
import { DECISIONS, type Decision } from "@/lib/ai/review/rules";
import { ownerId } from "./ai";
import { formObject, localeFrom } from "./helpers";
import type { ActionState } from "./types";

const decisionSchema = z.object({
  itemId: z.string().uuid(),
  decision: z.enum(DECISIONS as unknown as [Decision, ...Decision[]]),
  reason: z.string().trim().min(3).max(500),
  expectedVersion: z.coerce.number().int().min(1),
});

/** Maps a refusal to the code the screen shows. Nothing else about the refusal leaves the server. */
function failure(error: unknown): ActionState {
  if (error instanceof ReviewForbiddenError) return { ok: false, code: "forbidden" };
  if (error instanceof ReviewRuleError) {
    const code =
      error.code === "not_allowed_for_kind" || error.code === "not_decided" ? "rule_refused" : error.code === "invalid" ? "invalid_input" : error.code;
    return { ok: false, code };
  }
  return { ok: false, code: "generic" };
}

/**
 * Owner only. Decides one review item. The owner is checked on the server, the item is checked for kind and state, and
 * the version the owner saw must still be current. A decision that was already made is refused, never applied twice.
 */
export async function decideReviewAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };
  const parsed = decisionSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, code: "invalid_input" };
  try {
    const services = await createAiServices();
    const { item } = await services.review.decide({ kind: "owner", id: owner }, parsed.data.itemId, parsed.data.decision, parsed.data.reason, parsed.data.expectedVersion);
    revalidatePath(`/${locale}/admin/command-center`, "layout");
    return { ok: true, code: "saved", id: item.id };
  } catch (error) {
    return failure(error);
  }
}

const correctionSchema = z.object({
  itemId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
});

/**
 * Owner only. Records a correction to a decided item. The decision stays as it was; the correction is a new audit entry.
 */
export async function recordReviewCorrectionAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };
  const parsed = correctionSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, code: "invalid_input" };
  try {
    const services = await createAiServices();
    const item = await services.review.recordCorrection({ kind: "owner", id: owner }, parsed.data.itemId, parsed.data.reason);
    revalidatePath(`/${locale}/admin/command-center`, "layout");
    return { ok: true, code: "saved", id: item.id };
  } catch (error) {
    return failure(error);
  }
}
