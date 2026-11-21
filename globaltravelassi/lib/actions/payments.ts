"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { selfServicePaymentMethods } from "@/lib/domain";
import { checkProof, PROOF_MAX_BYTES, PROOF_MIME_TYPES, REASON_MAX, REASON_MIN } from "@/lib/payments/rules";
import { adminSession } from "./admin-session";
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
    [/Give a reason|Unknown decision/i, "invalid_input"],
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
  reason: z.string().trim().min(REASON_MIN).max(REASON_MAX),
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
  });
  if (!parsed.success) return { ok: false, code: "invalid_input" };

  const { data, error } = await admin.supabase.rpc("decide_payment", {
    p_payment: parsed.data.paymentId,
    p_decision: parsed.data.decision,
    p_reason: parsed.data.reason,
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
