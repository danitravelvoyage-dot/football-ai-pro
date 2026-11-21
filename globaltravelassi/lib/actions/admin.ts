"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { siteConfig } from "@/lib/config";
import { noteSchema, paymentSchema, serviceSchema, statusSchema } from "@/lib/validation/schemas";
import { formObject, localeFrom, parseWith } from "./helpers";
import type { ActionState } from "./types";
import { queueCustomerEmail, retryFailedCustomerEmails } from "@/lib/email/notify";
import { statusEmailKind } from "@/lib/email/kinds";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns a client authenticated as an ACTIVE ADMIN, or null. Checked on every admin action. */
async function adminClient() {
  const supabase = await createServerSupabase();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_active")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (!profile || profile.role !== "admin" || !profile.is_active) return null;
  return { supabase, userId: userData.user.id };
}

function refresh() {
  revalidatePath("/", "layout");
}

export async function updateStatusAction(formData: FormData): Promise<ActionState> {
  const admin = await adminClient();
  if (!admin) return { ok: false, code: "unauthorized" };
  const parsed = parseWith(statusSchema, formObject(formData));
  if (!parsed.ok) return parsed.state;
  // "Payment pending" is set only when a customer submits a proof. Setting it by hand would show a payment step with
  // no proof behind it.
  if (parsed.data.status === "payment_pending") return { ok: false, code: "invalid_input", fieldErrors: { status: "invalid_option" } };

  const { data, error } = await admin.supabase
    .from("applications")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.applicationId)
    .select("id, status");
  if (error) return { ok: false, code: "generic" };
  if (!data?.length) return { ok: false, code: "not_found" };

  const { data: event, error: eventError } = await admin.supabase
    .from("application_events")
    .insert({
      application_id: parsed.data.applicationId,
      kind: "status",
      to_status: parsed.data.status,
      message: parsed.data.message,
      actor_id: admin.userId,
    })
    .select("id")
    .single();
  if (eventError || !event) {
    // The status changed but the customer's timeline did not record it: say so instead of reporting full success.
    console.error("updateStatusAction: timeline event not written", eventError?.code);
    refresh();
    return { ok: false, code: "timeline_not_saved" };
  }
  const emailKind = statusEmailKind(parsed.data.status);
  if (emailKind) queueCustomerEmail(admin.supabase, emailKind, event.id);
  refresh();
  return { ok: true, code: "status_saved" };
}

export async function addNoteAction(formData: FormData): Promise<ActionState> {
  const admin = await adminClient();
  if (!admin) return { ok: false, code: "unauthorized" };
  const parsed = parseWith(noteSchema, formObject(formData));
  if (!parsed.ok) return parsed.state;

  const { error } = await admin.supabase.from("application_notes").insert({
    application_id: parsed.data.applicationId,
    author_id: admin.userId,
    body: parsed.data.body,
  });
  if (error) return { ok: false, code: "generic" };
  refresh();
  return { ok: true, code: "note_saved" };
}

/** Maps a payment-function refusal to the code the owner's screen shows. The database message is not shown. */
function manualPaymentFailure(message: string): ActionState {
  if (/cannot be deleted|changes only through|protected/i.test(message)) return { ok: false, code: "protected_records" };
  if (/not found/i.test(message)) return { ok: false, code: "not_found" };
  return { ok: false, code: "generic" };
}

export async function recordPaymentAction(formData: FormData): Promise<ActionState> {
  const admin = await adminClient();
  if (!admin) return { ok: false, code: "unauthorized" };
  const parsed = parseWith(paymentSchema, formObject(formData));
  if (!parsed.ok) return parsed.state;
  const input = parsed.data;

  // Owner-recorded payments are written by record_manual_payment(); the database checks the owner again.
  const { data, error } = await admin.supabase.rpc("record_manual_payment", {
    p_application: input.applicationId,
    p_amount: input.amount,
    p_currency: input.currency,
    p_method: input.method,
    p_status: input.status,
    p_reference: input.reference,
    p_note: input.note,
    p_received_on: input.receivedOn || null,
  });
  if (error || !data) return manualPaymentFailure(error?.message ?? "");

  if (input.status === "received") {
    await admin.supabase.from("application_events").insert({
      application_id: input.applicationId,
      kind: "payment",
      message: `${input.amount} ${input.currency}`,
      actor_id: admin.userId,
    });
  }
  refresh();
  return { ok: true, code: "payment_saved", id: String(data) };
}

export async function setPaymentStatusAction(formData: FormData): Promise<ActionState> {
  const admin = await adminClient();
  if (!admin) return { ok: false, code: "unauthorized" };
  const paymentId = String(formData.get("paymentId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!UUID.test(paymentId) || !["pending", "received", "cancelled"].includes(status)) return { ok: false, code: "invalid_input" };

  // A payment with a proof is refused here by the database: it changes only through its decision.
  const { error } = await admin.supabase.rpc("set_manual_payment_status", { p_payment: paymentId, p_status: status });
  if (error) return manualPaymentFailure(error.message);
  refresh();
  return { ok: true, code: "saved" };
}

export async function setDocumentVerifiedAction(formData: FormData): Promise<ActionState> {
  const admin = await adminClient();
  if (!admin) return { ok: false, code: "unauthorized" };
  const documentId = String(formData.get("documentId") ?? "");
  const verified = formData.get("verified") === "true";
  if (!UUID.test(documentId)) return { ok: false, code: "not_found" };
  const { data, error } = await admin.supabase.from("documents").update({ verified }).eq("id", documentId).select("id");
  if (error) return { ok: false, code: "generic" };
  if (!data?.length) return { ok: false, code: "not_found" };
  queueCustomerEmail(admin.supabase, "document_review_result", documentId);
  refresh();
  return { ok: true, code: "saved" };
}

/**
 * Owner only. Deletes a request. The database checks first, in one transaction: if any protected record exists (a proof,
 * a decided or audited payment, a removal), it refuses and nothing is deleted. Only then are the document files removed
 * from storage. If storage cannot remove them, the owner is told how many files may remain.
 */
export async function deleteApplicationAction(formData: FormData): Promise<ActionState> {
  const admin = await adminClient();
  if (!admin) return { ok: false, code: "unauthorized" };
  const applicationId = String(formData.get("applicationId") ?? "");
  // Validated: the locale goes into a redirect path, so a crafted value must not become another site's address.
  const locale = localeFrom(formData);
  if (!UUID.test(applicationId)) return { ok: false, code: "not_found" };

  const { data, error } = await admin.supabase.rpc("delete_application_request", { p_application: applicationId });
  if (error) {
    if (/protected payments or records/i.test(error.message)) return { ok: false, code: "protected_records" };
    if (/Request not found/i.test(error.message)) return { ok: false, code: "not_found" };
    return { ok: false, code: "generic" };
  }

  const paths = ((data ?? []) as string[]).filter(Boolean);
  if (paths.length) {
    const { error: removeError } = await admin.supabase.storage.from(siteConfig.documentBucket).remove(paths);
    if (removeError) {
      refresh();
      return { ok: false, code: "files_remaining", reference: String(paths.length) };
    }
  }
  refresh();
  redirect(`/${locale}/admin/applications?deleted=1`);
}

export async function saveServiceAction(formData: FormData): Promise<ActionState> {
  const admin = await adminClient();
  if (!admin) return { ok: false, code: "unauthorized" };
  const parsed = parseWith(serviceSchema, {
    id: formData.get("id") ?? "",
    slug: formData.get("slug"),
    category: formData.get("category"),
    titleAr: formData.get("titleAr"),
    titleFr: formData.get("titleFr"),
    titleEn: formData.get("titleEn"),
    descAr: formData.get("descAr") ?? "",
    descFr: formData.get("descFr") ?? "",
    descEn: formData.get("descEn") ?? "",
    price: formData.get("price") ?? "",
    currency: formData.get("currency"),
    isActive: formData.get("isActive") === "on",
    sortOrder: formData.get("sortOrder") ?? "0",
  });
  if (!parsed.ok) return parsed.state;
  const s = parsed.data;

  const row = {
    slug: s.slug,
    category: s.category,
    title_ar: s.titleAr,
    title_fr: s.titleFr,
    title_en: s.titleEn,
    description_ar: s.descAr,
    description_fr: s.descFr,
    description_en: s.descEn,
    price: s.price,
    currency: s.currency,
    is_active: s.isActive,
    sort_order: s.sortOrder,
  };

  const query = s.id
    ? admin.supabase.from("services").update(row).eq("id", s.id).select("id")
    : admin.supabase.from("services").insert(row).select("id");
  const { data, error } = await query;
  if (error) {
    if (error.code === "23505") return { ok: false, code: "invalid_option", fieldErrors: { slug: "invalid_option" } };
    return { ok: false, code: "generic" };
  }
  refresh();
  return { ok: true, code: "service_saved", id: data?.[0]?.id };
}

export async function setCustomerActiveAction(formData: FormData): Promise<ActionState> {
  const admin = await adminClient();
  if (!admin) return { ok: false, code: "unauthorized" };
  const profileId = String(formData.get("profileId") ?? "");
  const active = formData.get("active") === "true";
  if (!UUID.test(profileId) || profileId === admin.userId) return { ok: false, code: "unauthorized" };
  const { data, error } = await admin.supabase.from("profiles").update({ is_active: active }).eq("id", profileId).select("id");
  if (error) return { ok: false, code: "generic" };
  if (!data?.length) return { ok: false, code: "not_found" };
  refresh();
  return { ok: true, code: "customer_updated" };
}

/** Owner only. Another attempt for failed customer emails (at most five attempts each; a sent email is never resent). */
export async function retryFailedEmailsAction(): Promise<ActionState> {
  const admin = await adminClient();
  if (!admin) return { ok: false, code: "unauthorized" };
  const { data, error } = await admin.supabase
    .from("customer_email_notifications")
    .select("id")
    .eq("status", "failed")
    .lt("attempts", 5)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) return { ok: false, code: "generic" };
  const totals = await retryFailedCustomerEmails(admin.supabase, ((data ?? []) as { id: string }[]).map((r) => r.id));
  refresh();
  return { ok: true, code: "emails_retried", id: String(totals.sent), reference: String(totals.failed) };
}
