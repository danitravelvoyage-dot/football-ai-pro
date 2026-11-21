import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { siteConfig } from "@/lib/config";

export interface SessionCookie {
  name: string;
  value: string;
  options?: CookieOptions;
}

export interface SessionRefresh {
  user: User | null;
  /** Cookies the refresh wrote. The caller sets them on the response it returns, so the browser keeps the new session. */
  cookies: SessionCookie[];
}

/**
 * Refreshes the Supabase session and returns the signed-in user (or null). Uses getUser(), which validates the token
 * with Supabase.
 *
 * Refreshed cookies are written to the request too. The caller must build the headers it forwards to the page AFTER
 * this call, so server components see the refreshed session instead of the expired one.
 */
export async function refreshSession(request: NextRequest): Promise<SessionRefresh> {
  const written: SessionCookie[] = [];
  const supabase = createServerClient(siteConfig.supabaseUrl, siteConfig.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        written.push(...cookiesToSet);
      },
    },
  });
  const { data, error } = await supabase.auth.getUser();
  return { user: error ? null : data.user, cookies: written };
}
