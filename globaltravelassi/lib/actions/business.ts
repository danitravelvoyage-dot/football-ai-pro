"use server";

import { revalidatePath } from "next/cache";
import { createAiServices } from "@/lib/ai/services";
import { BusinessReportForbiddenError } from "@/lib/ai/business/service";
import { ownerId } from "./ai";
import { localeFrom } from "./helpers";
import type { ActionState } from "./types";

/** Owner only. Builds today's sales, marketing, customer-alert and recommendation notices. Each is posted once per day. */
export async function generateDailyReportsAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const owner = await ownerId();
  if (!owner) return { ok: false, code: "unauthorized" };
  try {
    const services = await createAiServices();
    const result = await services.businessReports.publishDaily({ kind: "owner", id: owner });
    revalidatePath(`/${locale}/admin/command-center`, "layout");
    return { ok: true, code: "saved", reference: `${result.created.length}` };
  } catch (error) {
    return { ok: false, code: error instanceof BusinessReportForbiddenError ? "forbidden" : "generic" };
  }
}
