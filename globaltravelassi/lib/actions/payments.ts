"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { selfServicePaymentMethods } from "@/lib/domain";
import { checkProof, PROOF_MAX_BYTES, PROOF_MIME_TYPES, REASON_MAX, REASON_MIN, rejectionMessageIsValid } from "@/lib/payments/rules";
import { adminSession } from "./admin-session";
import { siteConfig } from "@/lib/config";
import type { ActionState } from "./types";

/** Maps a database refusal to a code the screen shows. The database message is never shown to the visitor. */
function paymentFailure(message: string): ActionState {
  const rules: [RegExp, string][] = [
    [/Sign in/i, "unauthorized"],
    [/Only the owner/i, "forbidden"],
    [/Request not found|Payment not found/i, "not_found"],
    [/not open for payment/i, "not_open"],
    [/no price/i, "no_price"],
    [/not available/i, "unavailable"],
    [/PDF, JPEG/i, "invalid_file"],
    [/10 MB/i, "invalid_file"],
    [/own request folder/i, "invalid_path"],
    [/was not uploaded/i, "file_missing"],
    [/already waiting/i, "already_waiting"],
    [/already paid/i, "already_paid"],
    [/already decided/i, "already_decided"],
    [/Give a reason|Give the customer a message|Unknown decision/i, "invalid_input"],
    [/French, English and Arabic/i, "instructions_required"],
  ];
  const hit = rules.find(([pattern]) => pattern.test(message));
  return { ok: false, code: hit ? hit[1] : "generic" };
}

const refresh = () => revalidatePath("/", "layout");

const submitSchema = z.object({
  applicationId: z.string().uuid(),
  method: z.enum(selfServicePaymentMethods),
  storagePath: z.string().min(3).max(300),
  mimeType: z.enum(PROOF_MIME_TYPES),
  sizeBytes: z.number().int().min(1).max(PROOF_MAX_BYTES),
  fileName: z.string().min(1).max(200),
});

/**
 * Customer: attach a proof of transfer to an open request. The proof must already be uploaded to the customer's own
 * request folder. The amount comes from the service on the server; the client sends none.
 */
export async function submitPaymentEvidenceAction(input: {
  applicationId: string;
  method: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  fileName: string;
}): Promise<ActionState> {
  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid_input" };
  const d = parsed.data;

  const supabase = await createServerSupabase();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return { ok: false, code: "unauthorized" };

  const pre = checkProof({ userId, applicationId: d.applicationId, path: d.storagePath, mime: d.mimeType, size: d.sizeBytes });
  if (!pre.ok) return { ok: false, code: pre.code };

  const { data, error } = await supabase.rpc("submit_payment_evidence", {
    p_application: d.applicationId,
    p_method: d.method,
    p_storage_path: d.storagePath,
    p_mime: d.mimeType,
    p_size: d.sizeBytes,
    p_file_name: d.fileName,
  });
  if (error || !data) return paymentFailure(error?.message ?? "");
  refresh();
  return { ok: true, code: "submitted", id: String(data) };
}

const decideSchema = z.object({
  paymentId: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
  /** Internal: the owner's reason. Kept for the owner, never shown to the customer. */
  reason: z.string().trim().min(REASON_MIN).max(REASON_MAX),
  /** Shown to the customer. Required for a rejection; the database enforces it too. */
  customerMessage: z.string().trim().max(REASON_MAX),
});

/**
 * Owner only. Confirms funds actually received, or rejects the proof. Records the owner, the time and the reason.
 * The database refuses a second decision on the same payment.
 */
export async function decidePaymentAction(formData: FormData): Promise<ActionState> {
  const admin = await adminSession();
  if (!admin) return { ok: false, code: "unauthorized" };
  const parsed = decideSchema.safeParse({
    paymentId: String(formData.get("paymentId") ?? ""),
    decision: String(formData.get("decision") ?? ""),
    reason: String(formData.get("reason") ?? ""),
    customerMessage: String(formData.get("customerMessage") ?? ""),
  });
  if (!parsed.success) return { ok: false, code: "invalid_input" };
  if (parsed.data.decision === "reject" && !rejectionMessageIsValid(parsed.data.customerMessage)) return { ok: false, code: "invalid_input" };

  const { data, error } = await admin.supabase.rpc("decide_payment", {
    p_payment: parsed.data.paymentId,
    p_decision: parsed.data.decision,
    p_reason: parsed.data.reason,
    p_customer_message: parsed.data.customerMessage || null,
  });
  if (error || !data) return paymentFailure(error?.message ?? "");
  refresh();
  return { ok: true, code: String(data) === "received" ? "confirmed" : "rejected", id: parsed.data.paymentId };
}

const settingsSchema = z.object({
  method: z.enum(selfServicePaymentMethods),
  enabled: z.boolean(),
  instructionsFr: z.string().max(2000),
  instructionsEn: z.string().max(2000),
  instructionsAr: z.string().max(2000),
  reason: z.string().trim().min(REASON_MIN).max(REASON_MAX),
});

/** Owner only. Offers or withdraws a payment method, and sets its instructions. Every change keeps its reason. */
export async function saveMethodSettingsAction(formData: FormData): Promise<ActionState> {
  const admin = await adminSession();
  if (!admin) return { ok: false, code: "unauthorized" };
  const parsed = settingsSchema.safeParse({
    method: String(formData.get("method") ?? ""),
    enabled: formData.get("enabled") === "on",
    instructionsFr: String(formData.get("instructionsFr") ?? ""),
    instructionsEn: String(formData.get("instructionsEn") ?? ""),
    instructionsAr: String(formData.get("instructionsAr") ?? ""),
    reason: String(formData.get("reason") ?? ""),
  });
  if (!parsed.success) return { ok: false, code: "invalid_input" };
  const d = parsed.data;

  const { error } = await admin.supabase.rpc("save_payment_method", {
    p_method: d.method,
    p_enabled: d.enabled,
    p_fr: d.instructionsFr,
    p_en: d.instructionsEn,
    p_ar: d.instructionsAr,
    p_reason: d.reason,
  });
  if (error) return paymentFailure(error.message);
  refresh();
  return { ok: true, code: "saved" };
}

const purgeSchema = z.object({ reason: z.string().trim().min(REASON_MIN).max(REASON_MAX) });

/**
 * Owner only. Removes proofs that were uploaded and never submitted, and are older than seven days. For each file:
 * 1. the database records the intent, under the same lock a submission uses, after confirming the file is eligible;
 * 2. the file is removed through the storage API;
 * 3. the database records the result, and "removed" is written only when the file is confirmed gone.
 * A failed removal is recorded as failed and counted as failed. Nothing is reported as removed without confirmation.
 */
export async function purgeOrphanProofsAction(formData: FormData): Promise<ActionState> {
  const admin = await adminSession();
  if (!admin) return { ok: false, code: "unauthorized" };
  const parsed = purgeSchema.safeParse({ reason: String(formData.get("reason") ?? "") });
  if (!parsed.success) return { ok: false, code: "invalid_input" };
  const why = parsed.data.reason;

  const { data: candidates, error: listError } = await admin.supabase.rpc("orphan_payment_proofs", { p_retention: "7 days" });
  if (listError) return paymentFailure(listError.message);

  let removed = 0;
  let failed = 0;
  for (const row of (candidates ?? []) as { object_name: string }[]) {
    const { data: intentId, error: beginError } = await admin.supabase.rpc("begin_orphan_removal", {
      p_name: row.object_name,
      p_reason: why,
      p_retention: "7 days",
    });
    if (beginError || !intentId) continue; // no longer eligible, or already being removed: skipped, not counted

    const { error: removeError } = await admin.supabase.storage.from(siteConfig.documentBucket).remove([row.object_name]);
    const { data: outcome, error: finishError } = await admin.supabase.rpc("finish_orphan_removal", {
      p_removal: intentId,
      p_removed: !removeError,
      p_detail: removeError ? removeError.message.slice(0, 200) : null,
    });
    if (finishError || outcome !== "removed") {
      failed += 1;
    } else {
      removed += 1;
    }
  }
  refresh();
  return { ok: true, code: failed > 0 ? "purged_partial" : "purged", id: String(removed), reference: String(failed) };
}

/** Owner only. Resolves removals left open by an interrupted run: confirmed gone is recorded as removed, else as failed. */
export async function reconcileOrphanRemovalsAction(): Promise<ActionState> {
  const admin = await adminSession();
  if (!admin) return { ok: false, code: "unauthorized" };
  const { data, error } = await admin.supabase.rpc("reconcile_orphan_removals", { p_older_than: "1 hour" });
  if (error) return paymentFailure(error.message);
  refresh();
  return { ok: true, code: "reconciled", id: String((data ?? []).length) };
}
