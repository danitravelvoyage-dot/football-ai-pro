// Basic abuse protection: per-IP token-bucket rate limiting for API routes,
// plus a body-size guard for write requests. (In-memory per instance — for multi-instance
// deployments put a shared limiter such as Upstash/Redis or the platform firewall in front.)
import { NextResponse, type NextRequest } from "next/server";
import { checkInbound } from "@/lib/rateLimit";

export const config = { matcher: ["/api/:path*"] };

export function middleware(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  const write = req.method !== "GET" && req.method !== "HEAD";
  const { ok, retryAfterMs } = checkInbound(`${write ? "w" : "r"}:${ip}`, write ? 20 : 120);
  if (!ok) {
    return NextResponse.json(
      { error: "Too many requests", code: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } },
    );
  }
  const len = Number(req.headers.get("content-length") ?? 0);
  if (write && len > 10_000) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  return NextResponse.next();
}
