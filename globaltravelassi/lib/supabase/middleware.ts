import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import { siteConfig } from "@/lib/config";

/**
 * Refreshes the Supabase session cookies on every matched request and returns the
 * signed-in user (or null). Uses getUser(), which validates the token with Supabase.
 */
export async function refreshSession(request: NextRequest, response: NextResponse) {
  const supabase = createServerClient(siteConfig.supabaseUrl, siteConfig.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
}
