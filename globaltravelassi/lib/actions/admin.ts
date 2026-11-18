"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { siteConfig } from "@/lib/config";
import { noteSchema, paymentSchema, serviceSchema, statusSchema } from "@/lib/validation/schemas";
import { formObject, parseWith } from "./helpers";
import type { ActionState } from "./types";

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

  const { data, error } = await admin.supabase
    .from("applications")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.applicationId)
    .select("id, status");
  if (error) return { ok: false, code: "generic" };
  if (!data?.length) return { ok: false, code: "not_found" };

  await admin.supabase.from("application_events").insert({
    application_id: parsed.data.applicationId,
    kind: "status",
    to_status: parsed.data.status,
    message: parsed.data.message,
    actor_id: admin.userId,
  });
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

export async function recordPaymentAction(formData: FormData): Promise<ActionState> {
  const admin = await adminClient();
  if (!admin) return { ok: false, code: "unauthorized" };
  const parsed = parseWith(paymentSchema, formObject(formData));
  if (!parsed.ok) return parsed.state;
  const input = parsed.data;

  const receivedAt =
    input.status === "received" ? (input.receivedOn ? new Date(`${input.receivedOn}T12:00:00Z`).toISOString() : new Date().toISOString()) : null;

  const { data, error } = await admin.supabase
    .from("payments")
    .insert({
      application_id: input.applicationId,
      amount: input.amount,
      currency: input.currency,
      method: input.method,
      status: input.status,
      reference: input.reference,
      note: input.note,
      received_at: receivedAt,
      created_by: admin.userId,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, code: "generic" };

  if (input.status === "received") {
    await admin.supabase.from("application_events").insert({
      application_id: input.applicationId,
      kind: "payment",
      message: `${input.amount} ${input.currency}`,
      actor_id: admin.userId,
    });
  }
  refresh();
  return { ok: true, code: "payment_saved", id: data.id };
}

export async function setPaymentStatusAction(formData: FormData): Promise<ActionState> {
  const admin = await adminClient();
  if (!admin) return { ok: false, code: "unauthorized" };
  const paymentId = String(formData.get("paymentId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!UUID.test(paymentId) || !["pending", "received", "cancelled"].includes(status)) return { ok: false, code: "invalid_input" };

  const patch: Record<string, string | null> = { status };
  if (status === "received") patch.received_at = new Date().toISOString();
  if (status !== "received") patch.received_at = null;

  const { data, error } = await admin.supabase.from("payments").update(patch).eq("id", paymentId).select("id");
  if (error) return { ok: false, code: "generic" };
  if (!data?.length) return { ok: false, code: "not_found" };
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
  refresh();
  return { ok: true, code: "saved" };
}

export async function deleteApplicationAction(formData: FormData): Promise<ActionState> {
  const admin = await adminClient();
  if (!admin) return { ok: false, code: "unauthorized" };
  const applicationId = String(formData.get("applicationId") ?? "");
  const locale = String(formData.get("locale") ?? "ar");
  if (!UUID.test(applicationId)) return { ok: false, code: "not_found" };

  // Remove stored files first; the rows cascade when the request is deleted.
  const { data: docs } = await admin.supabase.from("documents").select("storage_path").eq("application_id", applicationId);
  const paths = (docs ?? []).map((d) => d.storage_path as string);
  if (paths.length) await admin.supabase.storage.from(siteConfig.documentBucket).remove(paths);

  // Payments reference the request with RESTRICT, so they are removed explicitly.
  await admin.supabase.from("payments").delete().eq("application_id", applicationId);
  const { data, error } = await admin.supabase.from("applications").delete().eq("id", applicationId).select("id");
  if (error) return { ok: false, code: "generic" };
  if (!data?.length) return { ok: false, code: "not_found" };
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
