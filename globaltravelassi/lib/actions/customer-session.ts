import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";

export type CustomerSession =
  | { ok: true; supabase: Awaited<ReturnType<typeof createServerSupabase>>; userId: string }
  | { ok: false; code: "unauthorized" | "disabled" };

/**
 * A client for a signed-in, ACTIVE account. Every customer write goes through it, so a disabled account cannot keep
 * submitting requests, documents or proofs by posting to the actions directly (the pages already redirect it).
 * Migration 0020 adds the same check to the database policies.
 */
export async function customerSession(): Promise<CustomerSession> {
  const supabase = await createServerSupabase();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return { ok: false, code: "unauthorized" };
  const { data: profile } = await supabase.from("profiles").select("is_active").eq("id", userId).maybeSingle();
  if (!profile || !profile.is_active) return { ok: false, code: "disabled" };
  return { ok: true, supabase, userId };
}
