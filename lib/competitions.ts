import type { Competition } from "@/types";

export interface CompetitionMeta extends Competition {
  /** Included in football-data.org free tier (per their published coverage; verify before relying on it). */
  footballDataFree: boolean;
  oddsApiKey?: string; // The Odds API sport key
  apiFootballLeague?: number; // API-Football league id
  color: string;
}

export const COMPETITIONS: CompetitionMeta[] = [
  { code: "PL", name: "Premier League", country: "England", countryCode: "ENG", type: "LEAGUE", footballDataFree: true, oddsApiKey: "soccer_epl", apiFootballLeague: 39, color: "#8b5cf6" },
  { code: "PD", name: "La Liga", country: "Spain", countryCode: "ESP", type: "LEAGUE", footballDataFree: true, oddsApiKey: "soccer_spain_la_liga", apiFootballLeague: 140, color: "#f97316" },
  { code: "SA", name: "Serie A", country: "Italy", countryCode: "ITA", type: "LEAGUE", footballDataFree: true, oddsApiKey: "soccer_italy_serie_a", apiFootballLeague: 135, color: "#3b82f6" },
  { code: "BL1", name: "Bundesliga", country: "Germany", countryCode: "DEU", type: "LEAGUE", footballDataFree: true, oddsApiKey: "soccer_germany_bundesliga", apiFootballLeague: 78, color: "#ef4444" },
  { code: "FL1", name: "Ligue 1", country: "France", countryCode: "FRA", type: "LEAGUE", footballDataFree: true, oddsApiKey: "soccer_france_ligue_one", apiFootballLeague: 61, color: "#06b6d4" },
  { code: "CL", name: "UEFA Champions League", country: "Europe", countryCode: "EUR", type: "CUP", footballDataFree: true, oddsApiKey: "soccer_uefa_champs_league", apiFootballLeague: 2, color: "#eab308" },
  { code: "EL", name: "UEFA Europa League", country: "Europe", countryCode: "EUR", type: "CUP", footballDataFree: false, oddsApiKey: "soccer_uefa_europa_league", apiFootballLeague: 3, color: "#f59e0b" },
  { code: "WC", name: "FIFA World Cup", country: "World", countryCode: "INT", type: "INTERNATIONAL", footballDataFree: true, oddsApiKey: "soccer_fifa_world_cup", apiFootballLeague: 1, color: "#10b981" },
  { code: "EC", name: "European Championship", country: "Europe", countryCode: "EUR", type: "INTERNATIONAL", footballDataFree: true, oddsApiKey: "soccer_uefa_european_championship", apiFootballLeague: 4, color: "#14b8a6" },
];

export const LEAGUE_CODES = COMPETITIONS.map((c) => c.code);

export function getCompetition(code: string): CompetitionMeta | undefined {
  return COMPETITIONS.find((c) => c.code === code.toUpperCase());
}

export function isValidCompetition(code: string): boolean {
  return !!getCompetition(code);
}
