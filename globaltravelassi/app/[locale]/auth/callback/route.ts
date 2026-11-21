import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";
import { isLocale, defaultLocale } from "@/lib/i18n/config";
import { sameOriginPath } from "@/lib/security/redirect";

export const dynamic = "force-dynamic";

/** Target of email links (confirmation, password reset). Exchanges the link for a session. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : defaultLocale;
  const url = request.nextUrl;
  const next = url.searchParams.get("next") ?? `/${locale}/dashboard`;
  const safeNext = sameOriginPath(next, `/${locale}/dashboard`, url.origin);

  const supabase = await createServerSupabase();
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

  let ok = false;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
  }

  const target = ok ? safeNext : `/${locale}/auth/login?error=expired`;
  return NextResponse.redirect(new URL(target, url.origin));
}
