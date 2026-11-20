"use server";

import { revalidatePath } from "next/cache";
import { createAiServices } from "@/lib/ai/services";
import { ForbiddenActorError } from "@/lib/ai/approvals";
import { SchedulerInputError } from "@/lib/ai/scheduler/service";
import { schedulerSettingsSchema } from "@/lib/ai/scheduler/schedule";
import { ownerId } from "./ai";
import { localeFrom, parseWith } from "./helpers";
import type { ActionState } from "./types";

function failure(error: unknown): ActionState {
  if (error instanceof ForbiddenActorError) return { ok: false, code: "forbidden" };
  if (error instanceof SchedulerInputError) return { ok: false, code: "invalid_input" };
  return { ok: false, code: "generic" };
}

/**
 * Owner-only. Saves the schedule. The checkbox sends "on" when enabled, and nothing otherwise.
 * The scheduler itself never changes these settings.
 */
export async function saveSchedulerSettingsAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };

  const parsed = parseWith(schedulerSettingsSchema, {
    enabled: formData.get("enabled") === "on",
    intervalMinutes: Number(formData.get("intervalMinutes")),
    timezone: String(formData.get("timezone") ?? "").trim(),
    leaseSeconds: Number(formData.get("leaseSeconds")),
    maxAttempts: Number(formData.get("maxAttempts")),
  });
  if (!parsed.ok) return parsed.state;

  try {
    const services = await createAiServices();
    await services.scheduler.updateSettings({ kind: "owner", id: owner }, parsed.data);
    revalidatePath(`/${locale}/admin/command-center`, "layout");
    return { ok: true, code: "saved" };
  } catch (error) {
    return failure(error);
  }
}
