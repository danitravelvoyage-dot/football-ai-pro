/**
 * Content-Security-Policy with a per-request nonce for scripts.
 *
 * The middleware generates a new nonce for every request and puts the policy on the request as well as the response.
 * Next.js reads the nonce from the request's script-src and applies it to its own inline scripts. No script-src
 * contains 'unsafe-inline' (except in development, where 'unsafe-eval' is also allowed for hot reload).
 *
 * style-src still allows 'unsafe-inline': React style props and the Next.js runtime emit inline styles that cannot be
 * nonced without a larger change. That gap is documented in docs/security/CONTENT_SECURITY_POLICY.md.
 */

/** Header that carries the policy when it is only observed. Enforcement uses Content-Security-Policy instead. */
export const CSP_REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only";

/** A fresh 128-bit nonce, base64 encoded. Uses the Web Crypto API, which exists in the Edge and Node runtimes. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Origins of the Supabase project, computed from the public project URL. Returns wildcards only when it is unset. */
export function supabaseOrigins(projectUrl: string): { http: string; ws: string } {
  try {
    const origin = new URL(projectUrl).origin;
    return { http: origin, ws: origin.replace(/^https:/, "wss:").replace(/^http:/, "ws:") };
  } catch {
    return { http: "https://*.supabase.co", ws: "wss://*.supabase.co" };
  }
}

export function buildCsp(nonce: string, options: { projectUrl: string; development: boolean }): string {
  const supabase = supabaseOrigins(options.projectUrl);
  const scriptSrc = [`'self'`, `'nonce-${nonce}'`, `'strict-dynamic'`];
  if (options.development) scriptSrc.push(`'unsafe-eval'`);
  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${supabase.http}`,
    "font-src 'self' data:",
    `connect-src 'self' ${supabase.http} ${supabase.ws}`,
    "media-src 'self' blob:",
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
