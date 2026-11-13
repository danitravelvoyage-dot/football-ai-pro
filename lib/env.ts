// Server-only environment configuration. Never import this from client components.
import "server-only";

function str(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

export const env = {
  footballDataKey: str("FOOTBALL_DATA_API_KEY"),
  footballDataRpm: Number(str("FOOTBALL_DATA_RATE_PER_MIN") ?? 10),
  oddsApiKey: str("ODDS_API_KEY"),
  oddsRegions: str("ODDS_API_REGIONS") ?? "eu",
  apiFootballKey: str("API_FOOTBALL_KEY"),
  apiFootballRpm: Number(str("API_FOOTBALL_RATE_PER_MIN") ?? 10),
  databaseUrl: str("DATABASE_URL"),
  dataMode: (str("DATA_MODE") ?? "auto") as "auto" | "live" | "demo",
  adminToken: str("ADMIN_TOKEN"),
};

/** DEMO mode is used when forced, or when no live fixtures key is configured. */
export function isDemoMode(): boolean {
  if (env.dataMode === "demo") return true;
  if (env.dataMode === "live") return false;
  return !env.footballDataKey;
}
