"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAiServices } from "@/lib/ai/services";
import { OwnerOnlyError } from "@/lib/ai/collaboration/consensus";
import { ConflictNotFoundError } from "@/lib/ai/collaboration/service";
import { ExchangeError } from "@/lib/ai/collaboration/communication";
import { ForbiddenActorError } from "@/lib/ai/approvals";
import { AGENT_KEYS } from "@/lib/ai/types";
import { ownerId } from "./ai";
import { formObject, localeFrom } from "./helpers";
import type { ActionState } from "./types";

const idSchema = z.string().uuid();
const agentSchema = z.enum(AGENT_KEYS);

function failure(error: unknown): ActionState {
  if (error instanceof OwnerOnlyError || error instanceof ForbiddenActorError) return { ok: false, code: "forbidden" };
  if (error instanceof ConflictNotFoundError) return { ok: false, code: "not_found" };
  if (error instanceof ExchangeError) return { ok: false, code: error.code === "limit" || error.code === "already_answered" ? "rule_refused" : "invalid_input" };
  return { ok: false, code: "generic" };
}

const refresh = (locale: string) => revalidatePath(`/${locale}/admin/command-center`, "layout");

/** Owner only. Records the owner's decision on an open conflict. The decision is final and audited. */
export async function resolveConflictAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };
  const f = formObject(formData);
  const id = idSchema.safeParse(f.id);
  const text = z.string().trim().min(3).max(500).safeParse(f.resolution ?? "");
  if (!id.success || !text.success) return { ok: false, code: "invalid_input" };
  try {
    const services = await createAiServices();
    await services.collaboration.resolveConflict({ kind: "owner", id: owner }, id.data, text.data);
    refresh(locale);
    return { ok: true, code: "saved" };
  } catch (error) {
    return failure(error);
  }
}

/** Owner only. Asks one agent a question about a run and, if it passes review, delivers the answer to the asking agent. */
export async function askAgentAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };
  const f = formObject(formData);
  const runId = idSchema.safeParse(f.runId);
  const fromAgent = agentSchema.safeParse(f.fromAgent);
  const toAgent = agentSchema.safeParse(f.toAgent);
  if (!runId.success || !fromAgent.success || !toAgent.success) return { ok: false, code: "invalid_input" };
  try {
    const services = await createAiServices();
    const actor = { kind: "owner" as const, id: owner };
    const { questionId } = await services.communication.ask(actor, { runId: runId.data, fromAgent: fromAgent.data, toAgent: toAgent.data, question: f.question ?? "" });
    const answered = await services.communication.answer(actor, { runId: runId.data, questionId });
    refresh(locale);
    return { ok: true, code: "saved", reference: answered.status };
  } catch (error) {
    return failure(error);
  }
}

/** Owner only. Cancels the tasks of a run that have not started. Running tasks and waiting approvals are left alone and reported. */
export async function cancelRunAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };
  const runId = idSchema.safeParse(formObject(formData).runId);
  if (!runId.success) return { ok: false, code: "invalid_input" };
  try {
    const services = await createAiServices();
    const result = await services.orchestrator.cancelRun({ kind: "owner", id: owner }, runId.data);
    refresh(locale);
    return { ok: true, code: "saved", reference: `${result.cancelled.length}` };
  } catch (error) {
    return failure(error);
  }
}
