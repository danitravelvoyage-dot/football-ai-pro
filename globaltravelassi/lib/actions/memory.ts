"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAiServices } from "@/lib/ai/services";
import { setBusinessEntry, BUSINESS_KEYS, BusinessKeyError } from "@/lib/ai/memory/business-context";
import { DECISIONS, EXPERIMENT_KINDS, METRICS, SUBJECT_TYPES, learningSettingsSchema } from "@/lib/ai/memory/types";
import { MemoryForbiddenError, MemoryValidationError } from "@/lib/ai/memory/service";
import { ContextVersionConflictError } from "@/lib/ai/context/store";
import { ContextValidationError, ContextForbiddenError } from "@/lib/ai/context/service";
import { formObject, localeFrom, parseWith } from "./helpers";
import { ownerId } from "./ai";
import type { ActionState } from "./types";

/**
 * Owner-only memory actions. Each one checks the owner first, validates its input, and calls the service,
 * which checks again. Nothing here approves a strategy or runs an external action: a decision is only a record.
 */

function refresh(locale: string) {
  revalidatePath(`/${locale}/admin/command-center`, "layout");
}

function failure(error: unknown): ActionState {
  if (error instanceof MemoryForbiddenError || error instanceof ContextForbiddenError) return { ok: false, code: "forbidden" };
  if (error instanceof MemoryValidationError || error instanceof ContextValidationError || error instanceof BusinessKeyError) return { ok: false, code: "invalid_input" };
  if (error instanceof ContextVersionConflictError) return { ok: false, code: "version_conflict" };
  return { ok: false, code: "generic" };
}

const decisionSchema = z.object({
  subjectType: z.enum(SUBJECT_TYPES),
  subjectRef: z.string().min(1).max(120),
  decision: z.enum(DECISIONS),
  reasoning: z.string().min(1).max(1000),
});

export async function recordDecisionAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };
  const parsed = parseWith(decisionSchema, formObject(formData));
  if (!parsed.ok) return parsed.state;
  try {
    const services = await createAiServices();
    const record = await services.memory.recordDecision({ kind: "owner", id: owner }, parsed.data);
    refresh(locale);
    return { ok: true, code: "saved", id: record.id };
  } catch (error) {
    return failure(error);
  }
}

const experimentSchema = z.object({
  kind: z.enum(EXPERIMENT_KINDS),
  name: z.string().min(2).max(120),
  hypothesis: z.string().min(5).max(500),
});

export async function createExperimentAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };
  const parsed = parseWith(experimentSchema, formObject(formData));
  if (!parsed.ok) return parsed.state;
  try {
    const services = await createAiServices();
    const record = await services.memory.createExperiment({ kind: "owner", id: owner }, parsed.data);
    refresh(locale);
    return { ok: true, code: "saved", id: record.id };
  } catch (error) {
    return failure(error);
  }
}

export async function setExperimentStatusAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };
  const parsed = parseWith(z.object({ id: z.string().uuid(), status: z.enum(["running", "finished"]) }), formObject(formData));
  if (!parsed.ok) return parsed.state;
  try {
    const services = await createAiServices();
    await services.memory.setExperimentStatus({ kind: "owner", id: owner }, parsed.data.id, parsed.data.status);
    refresh(locale);
    return { ok: true, code: "saved" };
  } catch (error) {
    return failure(error);
  }
}

const resultSchema = z.object({
  experimentId: z.string().uuid(),
  variant: z.string().min(1).max(60),
  metric: z.enum(METRICS),
  value: z.coerce.number().finite().min(0),
  sampleSize: z.coerce.number().int().min(1),
  source: z.enum(["aggregate", "manual", "import"]),
  period: z.string().min(2).max(40),
});

export async function recordResultAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };
  const parsed = parseWith(resultSchema, formObject(formData));
  if (!parsed.ok) return parsed.state;
  try {
    const services = await createAiServices();
    const { experimentId, ...result } = parsed.data;
    await services.memory.recordResult({ kind: "owner", id: owner }, experimentId, result);
    refresh(locale);
    return { ok: true, code: "saved" };
  } catch (error) {
    return failure(error);
  }
}

export async function saveLearningSettingsAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };
  const parsed = parseWith(learningSettingsSchema, {
    minSample: Number(formData.get("minSample")),
    minLift: Number(formData.get("minLift")),
  });
  if (!parsed.ok) return parsed.state;
  try {
    const services = await createAiServices();
    await services.memory.setLearningSettings({ kind: "owner", id: owner }, parsed.data);
    refresh(locale);
    return { ok: true, code: "saved" };
  } catch (error) {
    return failure(error);
  }
}

export async function saveBusinessEntryAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };
  const key = String(formData.get("key") ?? "");
  if (!(BUSINESS_KEYS as readonly string[]).includes(key)) return { ok: false, code: "invalid_input" };
  const text = String(formData.get("text") ?? "").trim();
  const expectedVersion = Number(formData.get("expectedVersion") ?? 0);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0 || text.length === 0 || text.length > 2000) {
    return { ok: false, code: "invalid_input" };
  }
  try {
    const services = await createAiServices();
    await setBusinessEntry(services.context, { kind: "owner", id: owner }, key, text, expectedVersion);
    refresh(locale);
    return { ok: true, code: "saved" };
  } catch (error) {
    return failure(error);
  }
}
