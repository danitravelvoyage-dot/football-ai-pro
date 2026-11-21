/**
 * Lead source attribution: which channel brought a visitor to the site and, through the request form, to a request.
 *
 * Rules (the owner's, and the reason each one exists):
 *  - Never invent a source. Anything not recognised is "other", never guessed.
 *  - A campaign tag (utm_source) wins over the referring site, because the owner set it on purpose.
 *  - A visitor with no tag and no referring site is "direct". A visitor from a site we do not map is "other".
 *  - Only the FIRST source of a visit is kept (first touch). A later visit does not overwrite it: the owner corrects a
 *    request's source with a reason, in the admin dashboard.
 *  - Only the source name and a short, safe campaign label are stored. No address, no user agent, no full URL.
 *
 * This module is pure (no request object, no database), so the edge middleware and the server actions both use it, and
 * it is tested on its own.
 */

export const LEAD_SOURCES = ["tiktok", "instagram", "facebook", "google", "whatsapp", "direct", "other"] as const;
export type AttributedSource = (typeof LEAD_SOURCES)[number];

export const LEAD_SOURCE_COOKIE = "gta_lead_source";
export const LEAD_SOURCE_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export interface Attribution {
  source: AttributedSource;
  /** A short campaign label from utm_source, when it is a safe, plain label. Never a URL. */
  detail: string | null;
}

const CAMPAIGN_LABEL = /^[a-z0-9][a-z0-9._-]{0,99}$/;

/** Campaign tag values to channels. Anything else is "other", with the tag kept as the detail. */
const TAG_TO_SOURCE: Record<string, AttributedSource> = {
  tiktok: "tiktok",
  tt: "tiktok",
  instagram: "instagram",
  ig: "instagram",
  insta: "instagram",
  facebook: "facebook",
  fb: "facebook",
  google: "google",
  google_ads: "google",
  "google-ads": "google",
  gads: "google",
  whatsapp: "whatsapp",
  wa: "whatsapp",
};

/** Referring hosts to channels. A host matches itself or any subdomain. */
const HOST_TO_SOURCE: [string, AttributedSource][] = [
  ["tiktok.com", "tiktok"],
  ["instagram.com", "instagram"],
  ["facebook.com", "facebook"],
  ["fb.com", "facebook"],
  ["whatsapp.com", "whatsapp"],
  ["wa.me", "whatsapp"],
];

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** google.com, google.dz, google.co.uk, google.fr ... (the search engine's own domains). */
function isGoogleHost(host: string): boolean {
  return /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host);
}

/** The referring host of a Referer header, or null. */
export function refererHost(referer: string | null | undefined): string | null {
  if (!referer) return null;
  try {
    const url = new URL(referer);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.hostname.toLowerCase().replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}

/**
 * Classifies one first visit. `siteHost` is this site's own host: a visit from the site itself is not a new source.
 */
export function classifyLeadSource(input: { utmSource?: string | null; referer?: string | null; siteHost?: string | null }): Attribution {
  const tag = (input.utmSource ?? "").trim().toLowerCase();
  if (tag) {
    const mapped = TAG_TO_SOURCE[tag];
    if (mapped) return { source: mapped, detail: CAMPAIGN_LABEL.test(tag) ? tag : null };
    return { source: "other", detail: CAMPAIGN_LABEL.test(tag) ? tag : null };
  }

  const host = refererHost(input.referer);
  if (!host) return { source: "direct", detail: null };
  const own = (input.siteHost ?? "").toLowerCase();
  if (own && hostMatches(host, own)) return { source: "direct", detail: null };

  for (const [domain, source] of HOST_TO_SOURCE) {
    if (hostMatches(host, domain)) return { source, detail: null };
  }
  if (isGoogleHost(host)) return { source: "google", detail: null };
  return { source: "other", detail: null };
}

/** Encodes the attribution for the cookie. */
export function encodeAttribution(a: Attribution): string {
  return a.detail ? `${a.source}|${a.detail}` : a.source;
}

/** Reads a cookie value back. Anything that is not a known source becomes "other": a tampered cookie cannot choose a channel. */
export function decodeAttribution(value: string | null | undefined): Attribution | null {
  if (!value) return null;
  const [sourcePart, ...rest] = value.split("|");
  const source = (LEAD_SOURCES as readonly string[]).includes(sourcePart ?? "") ? (sourcePart as AttributedSource) : "other";
  const detail = rest.join("|");
  return { source, detail: detail && CAMPAIGN_LABEL.test(detail) ? detail : null };
}
