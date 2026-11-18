import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { siteConfig } from "@/lib/config";
import { isLocale, defaultLocale } from "@/lib/i18n/config";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Opens a customer document. Row Level Security decides whether the visitor may read the
 * document row (owner or admin). A short-lived signed URL is then issued; the file itself is
 * never public.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale: raw, id } = await params;
  const locale = isLocale(raw) ? raw : defaultLocale;
  const loginUrl = new URL(`/${locale}/auth/login?next=${encodeURIComponent(`/${locale}/documents/${id}`)}`, request.nextUrl.origin);
  if (!UUID.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const supabase = await createServerSupabase();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.redirect(loginUrl);

  const { data: doc } = await supabase.from("documents").select("storage_path, file_name").eq("id", id).maybeSingle();
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { data: signed, error } = await supabase.storage
    .from(siteConfig.documentBucket)
    .createSignedUrl(doc.storage_path, 120, { download: doc.file_name });
  if (error || !signed?.signedUrl) return NextResponse.json({ error: "unavailable" }, { status: 502 });

  return NextResponse.redirect(signed.signedUrl, { status: 302, headers: { "Cache-Control": "private, no-store" } });
}
