import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Pure competitor-intelligence rules: source URL policy, page text and price extraction, change detection and
 * opportunity codes. No network, no model calls.
 *
 * Only public pages that the owner has registered are read. Each registered source must have its terms reviewed
 * by the owner before it can be monitored. Extracted prices are what the page displayed at the time; nothing is
 * estimated or inferred beyond that.
 */

export const SOURCE_KINDS = ["pricing_page", "offer_page", "news_page"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const OBSERVATION_STATUSES = ["ok", "fetch_failed", "robots_disallowed", "not_html", "too_large", "redirect_refused"] as const;
export type ObservationStatus = (typeof OBSERVATION_STATUSES)[number];

export const CURRENCIES = ["DZD", "EUR", "USD", "MAD", "TND"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const MAX_OFFERS = 50;
export const MAX_PAGE_BYTES = 1_000_000;
export const MIN_INTERVAL_HOURS_FLOOR = 6;

const BLOCKED_HOST_SUFFIXES = [".local", ".internal", ".localhost", ".test", ".example"];

/**
 * Returns the normalised origin-and-path of an allowed public URL, or the reason it was refused.
 * Only https, default port, a public DNS name, no credentials, no IP literals and no fragments.
 */
export function checkSourceUrl(raw: string): { ok: true; url: string; host: string } | { ok: false; reason: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "not_a_url" };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "not_https" };
  if (u.username || u.password) return { ok: false, reason: "credentials_in_url" };
  if (u.port && u.port !== "443") return { ok: false, reason: "non_default_port" };
  if (u.hash) return { ok: false, reason: "fragment_in_url" };
  const host = u.hostname.toLowerCase();
  if (host.startsWith("[") || host.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return { ok: false, reason: "ip_literal" };
  if (!host.includes(".")) return { ok: false, reason: "not_public_name" };
  if (host === "localhost" || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) return { ok: false, reason: "not_public_name" };
  if (u.pathname.length > 500 || u.search.length > 500) return { ok: false, reason: "url_too_long" };
  return { ok: true, url: `https://${host}${u.pathname}${u.search}`, host };
}


export const sourceInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  url: z.string().min(8).max(600),
  kind: z.enum(SOURCE_KINDS),
  purpose: z.string().trim().min(3).max(200),
  /** The owner has read the site's terms and confirms automated reading of this page is allowed. */
  termsReviewed: z.literal(true, { errorMap: () => ({ message: "Review the site's terms before monitoring it." }) }),
  minIntervalHours: z.number().int().min(MIN_INTERVAL_HOURS_FLOOR).max(24 * 30),
});
export type SourceInput = z.infer<typeof sourceInputSchema>;

/** Extracts visible text from HTML. Scripts, styles and tags are removed; whitespace is collapsed. */
export function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export interface Offer {
  currency: Currency;
  /** Price in minor units (cents, centimes or dinars × 100). */
  amountMinor: number;
  /** A short label taken from the text next to the price. Limited in length. */
  context: string;
}

const CURRENCY_TOKEN: Record<string, Currency> = { DZD: "DZD", DA: "DZD", EUR: "EUR", "€": "EUR", USD: "USD", $: "USD", MAD: "MAD", TND: "TND" };
const NUMBER = "(\\d{1,3}(?:[ .,\\u00a0]\\d{3})*(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)";
const BEFORE_CURRENCY = new RegExp(`${NUMBER}\\s*(DZD|DA|EUR|€|USD|\\$|MAD|TND)(?![A-Za-z])`, "g");
const AFTER_CURRENCY = new RegExp(`(DZD|EUR|USD|€|\\$|MAD|TND)\\s*${NUMBER}`, "g");

/** Parses a displayed number into a float. "12 000", "12,000", "12.000" and "12.50" are all read as displayed. */
export function parseDisplayedNumber(raw: string): number | null {
  const cleaned = raw.replace(/[\s ]/g, "");
  // A separator followed by exactly three digits is a thousands separator. Otherwise it is the decimal point.
  const thousands = /^\d{1,3}([.,]\d{3})+$/.test(cleaned);
  const normal = thousands ? cleaned.replace(/[.,]/g, "") : cleaned.replace(",", ".");
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

/** Finds displayed prices in page text. Each offer is a currency and an amount, with up to 60 characters of context. */
export function extractOffers(text: string): Offer[] {
  const found: Offer[] = [];
  const add = (match: RegExpExecArray, amountRaw: string, currencyRaw: string, index: number) => {
    const currency = CURRENCY_TOKEN[currencyRaw];
    const value = parseDisplayedNumber(amountRaw);
    if (!currency || value === null || value <= 0 || value > 100_000_000) return;
    const before = text.slice(Math.max(0, index - 60), index).trim();
    const context = (before.split(/\s+/).slice(-6).join(" ") || match[0]).slice(0, 60);
    found.push({ currency, amountMinor: Math.round(value * 100), context });
  };
  for (const m of text.matchAll(BEFORE_CURRENCY)) add(m, m[1] ?? "", m[2] ?? "", m.index ?? 0);
  for (const m of text.matchAll(AFTER_CURRENCY)) add(m, m[2] ?? "", m[1] ?? "", m.index ?? 0);
  const seen = new Set<string>();
  return found.filter((o) => {
    const key = `${o.currency}:${o.amountMinor}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_OFFERS);
}

export type ChangeCode = "content_changed" | "price_added" | "price_removed" | "lowest_price_up" | "lowest_price_down";

export interface Change {
  code: ChangeCode;
  currency?: Currency;
  /** Amounts in minor units, when the change is about a price. */
  from?: number | null;
  to?: number | null;
}

const key = (o: Offer) => `${o.currency}:${o.amountMinor}`;

function lowestByCurrency(offers: Offer[]): Map<Currency, number> {
  const out = new Map<Currency, number>();
  for (const o of offers) out.set(o.currency, Math.min(out.get(o.currency) ?? Infinity, o.amountMinor));
  return out;
}

/** Compares the previous successful observation with the new one. A first observation has no changes. */
export function detectChanges(prev: { contentHash: string; offers: Offer[] } | null, next: { contentHash: string; offers: Offer[] }): Change[] {
  if (!prev) return [];
  const changes: Change[] = [];
  if (prev.contentHash !== next.contentHash) changes.push({ code: "content_changed" });

  const before = new Set(prev.offers.map(key));
  const after = new Set(next.offers.map(key));
  for (const o of next.offers) if (!before.has(key(o))) changes.push({ code: "price_added", currency: o.currency, to: o.amountMinor });
  for (const o of prev.offers) if (!after.has(key(o))) changes.push({ code: "price_removed", currency: o.currency, from: o.amountMinor });

  const oldLow = lowestByCurrency(prev.offers);
  const newLow = lowestByCurrency(next.offers);
  for (const [currency, to] of newLow) {
    const from = oldLow.get(currency);
    if (from === undefined || from === to) continue;
    changes.push({ code: to > from ? "lowest_price_up" : "lowest_price_down", currency, from, to });
  }
  return changes;
}

export type OpportunityKind = "opportunity" | "threat";

export interface Opportunity {
  kind: OpportunityKind;
  code: "competitor_price_increase" | "competitor_price_decrease" | "competitor_offer_removed" | "competitor_offer_added";
  currency?: Currency;
}

/**
 * Maps changes to owner-facing signals. A competitor raising its lowest price is an opportunity for the owner.
 * A competitor lowering its price, or adding an offer, is a threat to watch. Removing an offer is an opportunity.
 */
export function opportunitiesFrom(changes: Change[]): Opportunity[] {
  const out: Opportunity[] = [];
  for (const c of changes) {
    if (c.code === "lowest_price_up") out.push({ kind: "opportunity", code: "competitor_price_increase", currency: c.currency });
    if (c.code === "lowest_price_down") out.push({ kind: "threat", code: "competitor_price_decrease", currency: c.currency });
    if (c.code === "price_removed") out.push({ kind: "opportunity", code: "competitor_offer_removed", currency: c.currency });
    if (c.code === "price_added") out.push({ kind: "threat", code: "competitor_offer_added", currency: c.currency });
  }
  return out;
}

/** Minimum wait before a source is read again. A source never fires more often than its configured interval. */
export function isDue(lastCheckedIso: string | null, nowIso: string, minIntervalHours: number): boolean {
  if (!lastCheckedIso) return true;
  return Date.parse(nowIso) - Date.parse(lastCheckedIso) >= minIntervalHours * 3_600_000;
}

