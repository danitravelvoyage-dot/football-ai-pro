"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { siteConfig } from "@/lib/config";
import { contactSchema, customerCategorySchema, leadSourceSchema, noteSchema, serviceSchema, statusSchema } from "@/lib/validation/schemas";
import { formObject, localeFrom, parseWith } from "./helpers";
import type { ActionState } from "./types";
import { queueCustomerEmail, retryFailedCustomerEmails } from "@/lib/email/notify";
import { statusEmailKind } from "@/lib/email/kinds";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns a client authenticated as an ACTIVE ADMIN, or null. Every admin action calls it first. The database checks the
 * same role again in every policy and function.
 */
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

/** Records an internal action. The activity log is append-only (migration 0023); a failed write is logged, not hidden. */
async function logActivity(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  actorId: string,
  applicationId: string,
  kind: "source_corrected" | "contact_logged" | "category_changed" | "status_changed" | "lead_recorded",
  detail: string,
) {
  const { error } = await supabase.from("crm_activity").insert({
    application_id: applicationId,
    actor_id: actorId,
    kind,
    detail: detail.slice(0, 300),
  });
  if (error) console.error("crm_activity write failed", error.code);
}

export async function updateStatusAction(formData: FormData): Promise<ActionState> {
  const admin = await adminClient();
  if (!admin) return { ok: false, code: "unauthorized" };
  const parsed = parseWith(statusSchema, formObject(formData));
  if (!parsed.ok) return parsed.state;

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
  await logActivity(admin.supabase, admin.userId, parsed.data.applicationId, "status_changed", parsed.data.status);
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

/**
 * Owner: records a contact with the customer (WhatsApp, email, phone, in person). WhatsApp is manual: the site opens a
 * chat, the owner sends the message, then records it here. Nothing is sent automatically.
 */
export async function logContactAction(formData: FormData): Promise<ActionState> {
  const admin = await adminClient();
  if (!admin) return { ok: false, code: "unauthorized" };
  const parsed = parseWith(contactSchema, formObject(formData));
  if (!parsed.ok) return parsed.state;

  const { data, error } = await admin.supabase
    .from("applications")
    .update({ last_contacted_at: new Date().toISOString(), last_contact_channel: parsed.data.channel })
    .eq("id", parsed.data.applicationId)
    .select("id");
  if (error) return { ok: false, code: "generic" };
  if (!data?.length) return { ok: false, code: "not_found" };
  await logActivity(admin.supabase, admin.userId, parsed.data.applicationId, "contact_logged", `${parsed.data.channel}${parsed.data.note ? `: ${parsed.data.note}` : ""}`);
  refresh();
  return { ok: true, code: "contact_saved" };
}

/**
 * Owner: corrects the lead source of a request. A recorded source changes only with a reason, which is written to the
 * activity log together with the old and new values. The database refuses a silent change (migration 0023).
 */
export async function correctLeadSourceAction(formData: FormData): Promise<ActionState> {
  const admin = await adminClient();
  if (!admin) return { ok: false, code: "unauthorized" };
  const parsed = parseWith(leadSourceSchema, formObject(formData));
  if (!parsed.ok) return parsed.state;

  const { data: current } = await admin.supabase.from("applications").select("lead_source").eq("id", parsed.data.applicationId).maybeSingle();
  if (!current) return { ok: false, code: "not_found" };
  const before = current.lead_source ?? "not_recorded";
  if (before === parsed.data.leadSource) return { ok: true, code: "saved" };

  const { data, error } = await admin.supabase
    .from("applications")
    .update({ lead_source: parsed.data.leadSource, lead_source_corrected_by: admin.userId, lead_source_corrected_at: new Date().toISOString() })
    .eq("id", parsed.data.applicationId)
    .select("id");
  if (error) return { ok: false, code: "generic" };
  if (!data?.length) return { ok: false, code: "not_found" };
  await logActivity(admin.supabase, admin.userId, parsed.data.applicationId, "source_corrected", `${before} → ${parsed.data.leadSource}: ${parsed.data.reason}`);
  refresh();
  return { ok: true, code: "saved" };
}

export async function setCustomerCategoryAction(formData: FormData): Promise<ActionState> {
  const admin = await adminClient();
  if (!admin) return { ok: false, code: "unauthorized" };
  const parsed = parseWith(customerCategorySchema, formObject(formData));
  if (!parsed.ok) return parsed.state;

  const { data, error } = await admin.supabase
    .from("applications")
    .update({ customer_category: parsed.data.category })
    .eq("id", parsed.data.applicationId)
    .select("id");
  if (error) return { ok: false, code: "generic" };
  if (!data?.length) return { ok: false, code: "not_found" };
  await logActivity(admin.supabase, admin.userId, parsed.data.applicationId, "category_changed", parsed.data.category);
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
 * Owner only. Deletes a request. The database checks first, in one transaction: a request that holds protected records
 * is refused and nothing is deleted. Only then are the document files removed from storage.
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
