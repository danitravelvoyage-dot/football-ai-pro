"use server";

import { revalidatePath } from "next/cache";
import { createAiServices } from "@/lib/ai/services";
import { KbForbiddenError, KbValidationError } from "@/lib/ai/knowledge/service";
import { KbVersionConflictError } from "@/lib/ai/knowledge/store";
import { ownerId } from "./ai";
import { formObject, localeFrom } from "./helpers";
import type { ActionState } from "./types";

function failure(error: unknown): ActionState {
  if (error instanceof KbForbiddenError) return { ok: false, code: "forbidden" };
  if (error instanceof KbValidationError) return { ok: false, code: "invalid_input" };
  if (error instanceof KbVersionConflictError) return { ok: false, code: "version_conflict" };
  return { ok: false, code: "generic" };
}

/**
 * Owner only. Creates an entry, or replaces the content of the entry with the same category, slug, language and
 * country. The previous content is kept as a version by the database. Tags are comma separated.
 */
export async function saveKnowledgeAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };
  const f = formObject(formData);
  const tags = (f.tags ?? "").split(",").map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0);
  try {
    const services = await createAiServices();
    await services.knowledge.save({ kind: "owner", id: owner }, {
      category: f.category,
      slug: f.slug,
      language: f.language,
      country: f.country,
      title: f.title,
      body: f.body,
      officialSourceUrl: f.officialSourceUrl ? f.officialSourceUrl : null,
      verifiedAt: f.verifiedAt ? new Date(f.verifiedAt).toISOString() : null,
      reliabilityStatus: f.reliabilityStatus,
      tags,
    });
    revalidatePath(`/${locale}/admin/command-center`, "layout");
    return { ok: true, code: "saved" };
  } catch (error) {
    return failure(error);
  }
}

/** Owner only. Archives an entry (status retired). It stays in the history and is no longer given to agents. */
export async function retireKnowledgeAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };
  try {
    const services = await createAiServices();
    await services.knowledge.review({ kind: "owner", id: owner }, String(formData.get("id") ?? ""), "retire", null);
    revalidatePath(`/${locale}/admin/command-center`, "layout");
    return { ok: true, code: "saved" };
  } catch (error) {
    return failure(error);
  }
}
