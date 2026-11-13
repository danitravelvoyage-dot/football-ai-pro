import { NextResponse } from "next/server";
import { cacheStats } from "@/lib/cache";
import { outboundRemaining } from "@/lib/rateLimit";
import { providerStatus } from "@/services/providers";

/** GET /api/status — provider configuration (never exposes keys), cache and quota state. */
export async function GET() {
  const s = providerStatus();
  return NextResponse.json({
    ...s,
    cache: cacheStats(),
    outboundTokens: { "football-data.org": outboundRemaining("football-data.org"), "The Odds API": outboundRemaining("The Odds API"), "API-Football": outboundRemaining("API-Football") },
    time: new Date().toISOString(),
  });
}
