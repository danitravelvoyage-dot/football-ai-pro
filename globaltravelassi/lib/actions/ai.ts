"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAiServices } from "@/lib/ai/services";
import { startWorkflowSchema } from "@/lib/ai/orchestration/engine";
import { formObject, localeFrom, parseWith } from "./helpers";
import type { ActionState } from "./types";

/** Returns the owner's id only for an active administrator. Every AI action starts here. */
async function ownerId(): Promise<string | null> {
  const supabase = await createServerSupabase();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("role, is_active").eq("id", user.id).maybeSingle();
  if (!profile || profile.role !== "admin" || !profile.is_active) return null;
  return user.id;
}

function refresh(locale: string) {
  revalidatePath(`/${locale}/admin/command-center`, "layout");
}

export async function startWorkflowAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };

  const parsed = parseWith(
    startWorkflowSchema.omit({ idempotencyKey: true, createdBy: true }),
    {
      ...formObject(formData),
      data: {},
      aggregates: [],
    },
  );
  if (!parsed.ok) return parsed.state;

  const services = await createAiServices();
  const idempotencyKey = `${owner}-${crypto.randomUUID()}`;
  const result = await services.orchestrator.startWorkflow({
    ...parsed.data,
    idempotencyKey,
    createdBy: owner,
  });
  refresh(locale);
  return { ok: true, code: "workflow_started", id: result.runId };
}

export async function tickAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };
  const services = await createAiServices();
  await services.orchestrator.tick({ limit: 5 });
  refresh(locale);
  return { ok: true, code: "tick_done" };
}

export async function decideApprovalAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };
  const approvalId = String(formData.get("approvalId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 500) || null;
  if (!/^[0-9a-f-]{36}$/i.test(approvalId) || (decision !== "approved" && decision !== "rejected")) {
    return { ok: false, code: "invalid_input" };
  }
  const services = await createAiServices();
  try {
    await services.orchestrator.decideApproval(approvalId, decision, { kind: "owner", id: owner }, note);
  } catch {
    return { ok: false, code: "generic" };
  }
  refresh(locale);
  return { ok: true, code: "decided" };
}

export async function retryTaskAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };
  const taskId = String(formData.get("taskId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) return { ok: false, code: "invalid_input" };
  const services = await createAiServices();
  try {
    await services.orchestrator.retryTask(taskId, { kind: "owner", id: owner });
  } catch {
    return { ok: false, code: "generic" };
  }
  refresh(locale);
  return { ok: true, code: "saved" };
}
