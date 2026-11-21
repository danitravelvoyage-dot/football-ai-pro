/**
 * Destination validation for every redirect that takes its target from the request (sign-in, sign-up, email links).
 *
 * The rule is strict same-origin: the candidate must be a plain path that resolves, with the WHATWG URL parser,
 * to the same origin as the base. Character rules run first because the URL parser silently removes tabs and
 * newlines and treats a backslash as a slash, so a string that looks like a path can become another host.
 */

/** Only used to resolve relative candidates. The result is compared against it, never redirected to. */
const SENTINEL_BASE = "https://same-origin.invalid";

/** C0 controls, space, DEL and backslash. None of these belongs in a plain path. */
const FORBIDDEN = /[\u0000- \u007F\\]/;

export function sameOriginPath(
  candidate: string | null | undefined,
  fallback: string,
  base: string = SENTINEL_BASE,
): string {
  if (!candidate) return fallback;
  if (FORBIDDEN.test(candidate)) return fallback;
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return fallback;

  let resolved: URL;
  let baseOrigin: string;
  try {
    resolved = new URL(candidate, base);
    baseOrigin = new URL(base).origin;
  } catch {
    return fallback;
  }
  if (resolved.origin !== baseOrigin) return fallback;
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
