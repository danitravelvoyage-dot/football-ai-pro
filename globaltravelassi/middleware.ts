import { NextResponse, type NextRequest } from "next/server";
import { defaultLocale, isLocale } from "@/lib/i18n/config";
import { refreshSession, type SessionRefresh } from "@/lib/supabase/middleware";
import { isSupabaseConfigured, siteConfig } from "@/lib/config";
import { buildCsp, CSP_REPORT_ONLY_HEADER, generateNonce } from "@/lib/security/csp";
import { classifyLeadSource, encodeAttribution, LEAD_SOURCE_COOKIE, LEAD_SOURCE_COOKIE_MAX_AGE } from "@/lib/attribution/lead-source";

/** Pages that need a signed-in user. Role checks happen in the page/route as well. */
const PROTECTED = /^\/(ar|fr|en)\/(dashboard|apply|admin|documents)(\/|$)/;

/** Exact paths only. Each trigger authenticates itself with the bearer secret. */
const TRIGGER_PATHS = new Set(["/api/ai/scheduler", "/api/ai/scheduler/watchdog"]);

/**
 * Every matched request gets its own nonce. The policy is set on the request too, so that Next.js can apply the nonce
 * to its inline scripts while rendering the page. Static assets are excluded by the matcher and carry no policy.
 */
export async function middleware(request: NextRequest) {
  const csp = buildCsp(generateNonce(), {
    projectUrl: siteConfig.supabaseUrl,
    development: process.env.NODE_ENV !== "production",
  });
  const response = await handleRequest(request, csp);
  response.headers.set(CSP_REPORT_ONLY_HEADER, csp);
  recordFirstSource(request, response);
  return response;
}

/**
 * Records where a visitor came from, once. The first source is kept: a later visit never overwrites it. The cookie is
 * httpOnly, lasts 30 days and holds only a source name and a short campaign label (see docs/PRIVACY_AND_COOKIES.md).
 */
function recordFirstSource(request: NextRequest, response: NextResponse) {
  if (request.method !== "GET" || request.cookies.has(LEAD_SOURCE_COOKIE)) return;
  if (TRIGGER_PATHS.has(request.nextUrl.pathname) || request.nextUrl.pathname.startsWith("/api/")) return;
  const attribution = classifyLeadSource({
    utmSource: request.nextUrl.searchParams.get("utm_source"),
    referer: request.headers.get("referer"),
    siteHost: request.nextUrl.hostname,
  });
  response.cookies.set(LEAD_SOURCE_COOKIE, encodeAttribution(attribution), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: LEAD_SOURCE_COOKIE_MAX_AGE,
  });
}

async function handleRequest(request: NextRequest, csp: string): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;

  // 0. The scheduler trigger has no locale and no browser session. It authenticates itself with a bearer secret.
  if (TRIGGER_PATHS.has(pathname)) return NextResponse.next();

  // 1. Locale prefix: every page lives under /ar, /fr or /en.
  const first = pathname.split("/")[1] ?? "";
  if (!isLocale(first)) {
    const cookieLocale = request.cookies.get("NEXT_LOCALE")?.value;
    const locale = cookieLocale && isLocale(cookieLocale) ? cookieLocale : defaultLocale;
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
    return NextResponse.redirect(url);
  }

  // 2. Keep the session fresh and protect private areas. The refresh runs first: it updates the request cookies.
  let session: SessionRefresh = { user: null, cookies: [] };
  if (isSupabaseConfigured()) {
    session = await refreshSession(request);
    if (!session.user && PROTECTED.test(pathname)) {
      const login = request.nextUrl.clone();
      login.pathname = `/${first}/auth/login`;
      login.search = `?next=${encodeURIComponent(pathname + search)}`;
      return withCookies(NextResponse.redirect(login), session);
    }
  } else if (PROTECTED.test(pathname)) {
    const login = request.nextUrl.clone();
    login.pathname = `/${first}/auth/login`;
    login.search = "";
    return NextResponse.redirect(login);
  }

  // 3. Forward the locale (root layout sets lang and dir), the nonce policy (Next.js nonces its scripts) and the
  //    refreshed session cookies. The headers are copied after the refresh, so the page never sees an expired token.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-locale", first);
  requestHeaders.set("Content-Security-Policy", csp);
  return withCookies(NextResponse.next({ request: { headers: requestHeaders } }), session);
}

function withCookies(response: NextResponse, session: SessionRefresh): NextResponse {
  for (const { name, value, options } of session.cookies) response.cookies.set(name, value, options);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon|opengraph-image|twitter-image|icons|images|.*\\.(?:svg|png|jpg|jpeg|webp|avif|ico|txt|xml|webmanifest)$).*)"],
};
