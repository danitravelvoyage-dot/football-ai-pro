/**
 * The nine service pages of the business. Kept in a small module so the middleware (Edge runtime) can check a slug
 * without loading the page content. `lib/services-content.ts` must cover exactly these slugs; a test enforces it.
 */
export const SERVICE_SLUGS = [
  "france-visa-appointment",
  "appointment-assistance",
  "visa-consulting",
  "visa-file-assistance",
  "e-visa",
  "flight-booking",
  "hotel-booking",
  "travel-itinerary",
  "transit-airport",
] as const;

export type ServiceSlug = (typeof SERVICE_SLUGS)[number];

export function isServiceSlug(value: string): value is ServiceSlug {
  return (SERVICE_SLUGS as readonly string[]).includes(value);
}

/** Matches /{locale}/services/{slug} (one segment, optional trailing slash) and returns the slug. */
const SERVICE_PAGE = /^\/(ar|fr|en)\/services\/([^/]+)\/?$/;

export function servicePageSlug(pathname: string): string | null {
  const match = SERVICE_PAGE.exec(pathname);
  return match ? decodeURIComponent(match[2]) : null;
}
