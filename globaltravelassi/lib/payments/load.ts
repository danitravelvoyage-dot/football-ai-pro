import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import { siteConfig } from "@/lib/config";
import type { MethodSetting } from "./rules";

/** The payment methods and their instructions, as stored. Readable by any signed-in user; written only by the owner. */
export async function loadPaymentMethodSettings(): Promise<MethodSetting[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("payment_method_settings")
    .select("method, enabled, instructions_fr, instructions_en, instructions_ar")
    .order("method", { ascending: true });
  return (data ?? []) as MethodSetting[];
}

/** The owner's history of method changes, newest first. Owner session only (RLS). */
export async function loadPaymentMethodHistory(limit = 30) {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("payment_method_history")
    .select("method, changed_at, reason, previous, next")
    .order("changed_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as { method: string; changed_at: string; reason: string; previous: Record<string, unknown>; next: Record<string, unknown> }[];
}

/** Proofs uploaded but never submitted and old enough to remove. Read only. */
export async function loadOrphanProofs() {
  const supabase = await createServerSupabase();
  const { data } = await supabase.rpc("orphan_payment_proofs", { p_retention: "7 days" });
  return (data ?? []) as { object_name: string; application_id: string; uploaded_at: string }[];
}

/**
 * Short-lived links to proof files, for the owner's review. The storage policy lets only the owner or the file's owner
 * read them; a link expires after five minutes.
 */
export async function loadProofLinks(paths: string[]): Promise<Map<string, string>> {
  const supabase = await createServerSupabase();
  const out = new Map<string, string>();
  for (const path of paths) {
    const { data } = await supabase.storage.from(siteConfig.documentBucket).createSignedUrl(path, 300);
    if (data?.signedUrl) out.set(path, data.signedUrl);
  }
  return out;
}
