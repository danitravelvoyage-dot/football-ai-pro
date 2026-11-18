import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { siteConfig } from "@/lib/config";

/** Supabase client bound to the visitor's cookies. Row Level Security applies to every query. */
export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(siteConfig.supabaseUrl, siteConfig.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: cookies can only be written from actions and route handlers.
          // The middleware refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}
