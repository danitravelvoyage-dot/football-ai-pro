// Fuzzy team-name matching between providers (different providers spell clubs differently).
import type { TeamRef } from "@/types";

const STOP = new Set(["fc", "cf", "afc", "sc", "ac", "ssc", "as", "club", "de", "the", "calcio", "1", "football", "sv", "vfl", "vfb", "rc", "ud", "cd", "fk", "sk"]);

export function normaliseName(s: string): string[] {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));
}

export function nameSimilarity(a: string, b: string): number {
  const A = new Set(normaliseName(a)),
    B = new Set(normaliseName(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w) || [...B].some((x) => x.length > 3 && w.length > 3 && (x.startsWith(w) || w.startsWith(x)))) inter++;
  return inter / Math.min(A.size, B.size);
}

export function teamsMatch(name: string, team: TeamRef): boolean {
  return Math.max(nameSimilarity(name, team.name), nameSimilarity(name, team.shortName)) >= 0.99 ||
    (Math.max(nameSimilarity(name, team.name), nameSimilarity(name, team.shortName)) >= 0.5 && normaliseName(name).length > 0 &&
      normaliseName(name)[0] === normaliseName(team.shortName)[0]);
}
