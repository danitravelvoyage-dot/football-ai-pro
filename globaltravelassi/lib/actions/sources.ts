"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAiServices } from "@/lib/ai/services";
import { SourceConflictError, SourceForbiddenError, SourceNotFoundError, SourceRemovedError } from "@/lib/ai/sources/service";
import { SourceRuleError, SOURCE_CATEGORIES, JURISDICTIONS } from "@/lib/ai/sources/rules";
import { ownerId } from "./ai";
import { formObject, localeFrom } from "./helpers";
import type { ActionState } from "./types";

const reason = z.string().trim().min(3).max(500);
const expiry = z.string().trim().optional().transform((v) => (v ? new Date(`${v}T23:59:59.000Z`).toISOString() : null));

const addSchema = z.object({
  host: z.string().trim().min(4).max(255),
  category: z.enum(SOURCE_CATEGORIES),
  jurisdiction: z.enum(JURISDICTIONS),
  purpose: z.string().trim().min(2).max(200),
  expiresAt: expiry,
  reason,
});

const changeSchema = z.object({
  host: z.string().trim().min(4).max(255),
  intent: z.enum(["edit", "disable", "enable", "revalidate", "remove"]),
  expectedVersion: z.coerce.number().int().min(1),
  category: z.enum(SOURCE_CATEGORIES).optional(),
  jurisdiction: z.enum(JURISDICTIONS).optional(),
  purpose: z.string().trim().max(200).optional(),
  expiresAt: expiry,
  reason,
});

function failure(error: unknown): ActionState {
  if (error instanceof SourceForbiddenError) return { ok: false, code: "forbidden" };
  if (error instanceof SourceConflictError) return { ok: false, code: "stale" };
  if (error instanceof SourceNotFoundError) return { ok: false, code: "not_found" };
  if (error instanceof SourceRemovedError) return { ok: false, code: "rule_refused" };
  if (error instanceof SourceRuleError) return { ok: false, code: "invalid_input" };
  return { ok: false, code: "generic" };
}

const refresh = (locale: string) => revalidatePath(`/${locale}/admin/command-center`, "layout");

/** Owner only. Adds a host to the registry. Approving a host does not verify its content. */
export async function addSourceAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };
  const parsed = addSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, code: "invalid_input" };
  try {
    const services = await createAiServices();
    const row = await services.sources.add({ kind: "owner", id: owner }, parsed.data, parsed.data.reason);
    refresh(locale);
    return { ok: true, code: "saved", id: row.host };
  } catch (error) {
    return failure(error);
  }
}

/** Owner only. Edits, disables, enables, revalidates or removes one host, checked against the version the owner saw. */
export async function changeSourceAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };
  const parsed = changeSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, code: "invalid_input" };
  const d = parsed.data;
  const actor = { kind: "owner" as const, id: owner };
  try {
    const services = await createAiServices();
    if (d.intent === "edit") {
      if (!d.category || !d.jurisdiction || !d.purpose) return { ok: false, code: "invalid_input" };
      await services.sources.edit(actor, d.host, d.expectedVersion, { category: d.category, jurisdiction: d.jurisdiction, purpose: d.purpose, expiresAt: d.expiresAt }, d.reason);
    } else if (d.intent === "disable" || d.intent === "enable") {
      await services.sources.setStatus(actor, d.host, d.expectedVersion, d.intent === "disable" ? "disabled" : "active", d.reason);
    } else if (d.intent === "revalidate") {
      await services.sources.revalidate(actor, d.host, d.expectedVersion, d.reason);
    } else {
      await services.sources.remove(actor, d.host, d.expectedVersion, d.reason);
    }
    refresh(locale);
    return { ok: true, code: "saved" };
  } catch (error) {
    return failure(error);
  }
}
