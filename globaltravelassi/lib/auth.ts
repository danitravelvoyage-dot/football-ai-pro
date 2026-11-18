import "server-only";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/config";
import type { ProfileRow } from "@/lib/domain";
import type { Locale } from "@/lib/i18n/config";

export async function getCurrentUser(): Promise<User | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
}

export async function getCurrentProfile(): Promise<ProfileRow | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("profiles")
    .select("id, email, full_name, whatsapp, role, is_active, created_at")
    .eq("id", user.id)
    .maybeSingle();
  return (data as ProfileRow | null) ?? null;
}

export function loginPath(locale: Locale, next?: string): string {
  return next ? `/${locale}/auth/login?next=${encodeURIComponent(next)}` : `/${locale}/auth/login`;
}

/** For customer pages: signed-in, active account required. Redirects otherwise. */
export async function requireCustomer(locale: Locale, nextPath: string): Promise<{ user: User; profile: ProfileRow }> {
  const user = await getCurrentUser();
  if (!user) redirect(loginPath(locale, nextPath));
  const profile = await getCurrentProfile();
  if (!profile) redirect(loginPath(locale, nextPath));
  if (!profile.is_active) redirect(`/${locale}/auth/login?error=disabled`);
  return { user, profile };
}

/** For admin pages: signed-in active administrator required. */
export async function requireAdmin(locale: Locale, nextPath: string): Promise<{ user: User; profile: ProfileRow }> {
  const user = await getCurrentUser();
  if (!user) redirect(loginPath(locale, nextPath));
  const profile = await getCurrentProfile();
  if (!profile || !profile.is_active) redirect(`/${locale}/auth/login?error=disabled`);
  if (profile.role !== "admin") redirect(`/${locale}/dashboard?error=denied`);
  return { user, profile };
}
