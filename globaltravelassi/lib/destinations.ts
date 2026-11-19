/** Popular destinations shown on the homepage (ISO 3166-1 alpha-2). Names come from Intl, so they are translated automatically. */
export const popularDestinations = ["FR", "ES", "IT", "DE", "PT", "GR", "NL", "BE"] as const;

/** Regional-indicator flag emoji for a country code. */
export function flagEmoji(code: string): string {
  return code
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}
