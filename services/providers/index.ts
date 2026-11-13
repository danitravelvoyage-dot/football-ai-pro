// Provider registry: picks live providers when keys are configured, otherwise clearly-labelled DEMO.
import "server-only";
import { env, isDemoMode } from "@/lib/env";
import { ApiFootballProvider } from "./apiFootball";
import { DemoFixturesProvider, DemoOddsProvider, DemoTeamNewsProvider } from "./demo";
import { FootballDataProvider } from "./footballData";
import { OddsApiProvider } from "./oddsApi";
import type { FixturesProvider, OddsProvider, TeamNewsProvider } from "./types";

const unavailableOdds: OddsProvider = {
  name: "none",
  async getOdds() {
    return { unavailable: true, reasonKey: "odds.notConfigured" };
  },
};
const unavailableNews: TeamNewsProvider = {
  name: "none",
  async getAvailability() {
    return { unavailable: true, reasonKey: "teamnews.notConfigured" };
  },
  async getLineups() {
    return { unavailable: true, reasonKey: "teamnews.notConfigured" };
  },
  async getNews() {
    return { unavailable: true, reasonKey: "news.noSource" };
  },
};

let fixtures: FixturesProvider | null = null;
export function getFixturesProvider(): FixturesProvider {
  if (!fixtures) fixtures = isDemoMode() || !env.footballDataKey ? new DemoFixturesProvider() : new FootballDataProvider(env.footballDataKey);
  return fixtures;
}

export function getOddsProvider(): OddsProvider {
  if (isDemoMode()) return new DemoOddsProvider();
  return env.oddsApiKey ? new OddsApiProvider(env.oddsApiKey) : unavailableOdds;
}

export function getTeamNewsProvider(): TeamNewsProvider {
  if (isDemoMode()) return new DemoTeamNewsProvider();
  return env.apiFootballKey ? new ApiFootballProvider(env.apiFootballKey) : unavailableNews;
}

export interface ProviderStatus {
  id: string;
  name: string;
  role: string; // i18n key
  configured: boolean;
  active: boolean;
  url: string;
  freeTier: string; // i18n key
}

export function providerStatus(): { demo: boolean; providers: ProviderStatus[] } {
  const demo = isDemoMode();
  return {
    demo,
    providers: [
      { id: "fd", name: "football-data.org", role: "providers.role.fixtures", configured: !!env.footballDataKey, active: !demo && !!env.footballDataKey, url: "https://www.football-data.org", freeTier: "providers.free.fd" },
      { id: "odds", name: "The Odds API", role: "providers.role.odds", configured: !!env.oddsApiKey, active: !demo && !!env.oddsApiKey, url: "https://the-odds-api.com", freeTier: "providers.free.odds" },
      { id: "af", name: "API-Football", role: "providers.role.teamnews", configured: !!env.apiFootballKey, active: !demo && !!env.apiFootballKey, url: "https://www.api-football.com", freeTier: "providers.free.af" },
      { id: "understat", name: "Understat (xG)", role: "providers.role.xg", configured: false, active: false, url: "https://understat.com", freeTier: "providers.free.understat" },
      { id: "sofascore", name: "Sofascore", role: "providers.role.sofascore", configured: false, active: false, url: "https://www.sofascore.com", freeTier: "providers.free.sofascore" },
      { id: "db", name: "PostgreSQL / Supabase", role: "providers.role.db", configured: !!env.databaseUrl, active: !!env.databaseUrl, url: "https://supabase.com", freeTier: "providers.free.db" },
    ],
  };
}
