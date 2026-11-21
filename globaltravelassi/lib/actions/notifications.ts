"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAiServices } from "@/lib/ai/services";
import { ForbiddenActorError } from "@/lib/ai/approvals";
import { ownerId } from "./ai";
import { localeFrom, parseWith } from "./helpers";
import type { ActionState } from "./types";

const markReadSchema = z.object({ id: z.string().uuid() });

/** Owner only. Marks one notice as read. Marking an already-read notice changes nothing and is reported as not found. */
export async function markNotificationReadAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };
  const parsed = parseWith(markReadSchema, { id: String(formData.get("id") ?? "") });
  if (!parsed.ok) return parsed.state;
  try {
    const services = await createAiServices();
    const changed = await services.notifications.markRead({ kind: "owner", id: owner }, parsed.data.id);
    revalidatePath(`/${locale}/admin/command-center`, "layout");
    return changed ? { ok: true, code: "saved" } : { ok: false, code: "invalid_input" };
  } catch (error) {
    return { ok: false, code: error instanceof ForbiddenActorError ? "forbidden" : "generic" };
  }
}
