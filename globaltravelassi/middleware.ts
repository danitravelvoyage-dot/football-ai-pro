import { NextResponse, type NextRequest } from "next/server";
import { defaultLocale, isLocale } from "@/lib/i18n/config";
import { refreshSession } from "@/lib/supabase/middleware";
import { isSupabaseConfigured } from "@/lib/config";

/** Pages that need a signed-in user. Role checks happen in the page/route as well. */
const PROTECTED = /^\/(ar|fr|en)\/(dashboard|apply|admin|documents)(\/|$)/;

/** Exact path only. Authentication of this route is its own job (see app/api/ai/scheduler/route.ts). */
const SCHEDULER_TRIGGER_PATH = "/api/ai/scheduler";

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // 0. The scheduler trigger has no locale and no browser session. It authenticates itself with a bearer secret.
  if (pathname === SCHEDULER_TRIGGER_PATH) return NextResponse.next();

  // 1. Locale prefix: every page lives under /ar, /fr or /en.
  const first = pathname.split("/")[1] ?? "";
  if (!isLocale(first)) {
    const cookieLocale = request.cookies.get("NEXT_LOCALE")?.value;
    const locale = cookieLocale && isLocale(cookieLocale) ? cookieLocale : defaultLocale;
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
    return NextResponse.redirect(url);
  }

  // 2. Pass the locale to the root layout (sets lang and dir).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-locale", first);
  const response = NextResponse.next({ request: { headers: requestHeaders } });

  // 3. Keep the session fresh and protect private areas.
  if (isSupabaseConfigured()) {
    const user = await refreshSession(request, response);
    if (!user && PROTECTED.test(pathname)) {
      const login = request.nextUrl.clone();
      login.pathname = `/${first}/auth/login`;
      login.search = `?next=${encodeURIComponent(pathname + search)}`;
      return NextResponse.redirect(login);
    }
  } else if (PROTECTED.test(pathname)) {
    const login = request.nextUrl.clone();
    login.pathname = `/${first}/auth/login`;
    login.search = "";
    return NextResponse.redirect(login);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon|opengraph-image|twitter-image|icons|images|.*\\.(?:svg|png|jpg|jpeg|webp|avif|ico|txt|xml|webmanifest)$).*)"],
};

