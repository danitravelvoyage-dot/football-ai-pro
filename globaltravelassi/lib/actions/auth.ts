"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { siteConfig } from "@/lib/config";
import { loginSchema, passwordSchema, profileSchema, registerSchema } from "@/lib/validation/schemas";
import type { Locale } from "@/lib/i18n/config";
import { formObject, localeFrom, parseWith, safeNext } from "./helpers";
import { type ActionState } from "./types";

function authErrorCode(message: string, status?: number): string {
  if (status === 429) return "rate_limit";
  const text = message.toLowerCase();
  if (text.includes("invalid login credentials")) return "invalid";
  if (text.includes("email not confirmed")) return "not_confirmed";
  if (text.includes("already registered") || text.includes("already exists")) return "exists";
  if (text.includes("expired")) return "expired";
  return "generic";
}

export async function signInAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const parsed = parseWith(loginSchema, formObject(formData));
  if (!parsed.ok) return parsed.state;

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) return { ok: false, code: authErrorCode(error.message, error.status) };

  const { data: userData } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_active")
    .eq("id", userData.user?.id ?? "")
    .maybeSingle();
  if (!profile || !profile.is_active) {
    await supabase.auth.signOut();
    return { ok: false, code: "disabled" };
  }
  const fallback = profile.role === "admin" ? `/${locale}/admin` : `/${locale}/dashboard`;
  redirect(safeNext(String(formData.get("next") ?? ""), locale, fallback));
}

export async function signUpAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const parsed = parseWith(registerSchema, formObject(formData));
  if (!parsed.ok) return parsed.state;
  const next = safeNext(String(formData.get("next") ?? ""), locale);

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName, whatsapp: parsed.data.whatsapp },
      emailRedirectTo: `${siteConfig.siteUrl}/${locale}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) return { ok: false, code: authErrorCode(error.message, error.status) };
  if (data.session) redirect(next);
  return { ok: true, code: "check_email" };
}

export async function requestPasswordResetAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const email = z.string().trim().email().max(254).safeParse(formData.get("email"));
  if (!email.success) return { ok: false, code: "invalid_input", fieldErrors: { email: "invalid_email" } };

  const supabase = await createServerSupabase();
  await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${siteConfig.siteUrl}/${locale}/auth/callback?next=${encodeURIComponent(`/${locale}/auth/update-password`)}`,
  });
  // Same answer whether or not the account exists, so the form cannot be used to find customers.
  return { ok: true, code: "forgot_sent" };
}

export async function updatePasswordAction(formData: FormData): Promise<ActionState> {
  const locale = localeFrom(formData);
  const parsed = parseWith(
    z
      .object({ password: passwordSchema, confirmPassword: z.string() })
      .refine((v) => v.password === v.confirmPassword, { message: "mismatch", path: ["confirmPassword"] }),
    formObject(formData),
  );
  if (!parsed.ok) return parsed.state;

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, code: authErrorCode(error.message, error.status) };
  redirect(`/${locale}/dashboard?password=updated`);
}

export async function signOutAction(formData: FormData): Promise<void> {
  const locale = localeFrom(formData);
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect(`/${locale}`);
}

export async function updateProfileAction(formData: FormData): Promise<ActionState> {
  const locale: Locale = localeFrom(formData);
  const parsed = parseWith(profileSchema, { fullName: formData.get("fullName"), whatsapp: formData.get("whatsapp") });
  if (!parsed.ok) return parsed.state;

  const supabase = await createServerSupabase();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false, code: "unauthorized" };
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: parsed.data.fullName, whatsapp: parsed.data.whatsapp })
    .eq("id", userData.user.id);
  if (error) return { ok: false, code: "generic" };
  revalidatePath(`/${locale}`, "layout");
  return { ok: true, code: "profile_saved" };
}
