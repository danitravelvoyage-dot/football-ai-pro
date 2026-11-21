import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";

/** A client authenticated as an ACTIVE ADMIN, or null. The database checks the same role again in every owner function. */
export async function adminSession() {
  const supabase = await createServerSupabase();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;
  const { data: profile } = await supabase.from("profiles").select("role, is_active").eq("id", userData.user.id).maybeSingle();
  if (!profile || profile.role !== "admin" || !profile.is_active) return null;
  return { supabase, userId: userData.user.id };
}
