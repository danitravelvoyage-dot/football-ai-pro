import { fileURLToPath } from "node:url";

/**
 * Content-Security-Policy, report-only for now: violations are reported in the browser console and the policy is not
 * enforced. Next.js App Router inlines its bootstrap scripts without a nonce, so script-src keeps 'unsafe-inline'.
 * Moving to enforcement needs nonces (or hashes) first; see docs/security/CONTENT_SECURITY_POLICY.md.
 */
function supabaseOrigins() {
  // Only the public project URL is read here, and only its origin is used. No keys are touched.
  try {
    const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
    return { http: origin, ws: origin.replace(/^https:/, "wss:").replace(/^http:/, "ws:") };
  } catch {
    return { http: "https://*.supabase.co", ws: "wss://*.supabase.co" };
  }
}

function contentSecurityPolicy() {
  const supabase = supabaseOrigins();
  const dev = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
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

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
  poweredByHeader: false,
  images: { formats: ["image/avif", "image/webp"] },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy() },
        ],
      },
    ];
  },
};
export default nextConfig;
