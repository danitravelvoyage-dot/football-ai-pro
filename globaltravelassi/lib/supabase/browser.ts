"use client";

import { createBrowserClient } from "@supabase/ssr";
import { siteConfig } from "@/lib/config";

export function createBrowserSupabase() {
  return createBrowserClient(siteConfig.supabaseUrl, siteConfig.supabaseAnonKey);
}
