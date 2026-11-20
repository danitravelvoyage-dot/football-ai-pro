/** Pure helpers for the memory pages. No database or server-only imports, so each rule is unit-tested. */

/** Parses "type:ref" from a query string. Anything else is no subject. */
export function parseSubject(raw: string | undefined): { type: string; ref: string } | null {
  if (!raw) return null;
  const idx = raw.indexOf(":");
  if (idx <= 0) return null;
  const type = raw.slice(0, idx);
  const ref = raw.slice(idx + 1);
  if (!/^[a-z]+$/.test(type) || ref.length === 0 || ref.length > 120) return null;
  return { type, ref };
}

/** Whole positive version number, or null. */
export function parseVersion(raw: string | undefined): number | null {
  if (!raw || !/^\d{1,6}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 ? n : null;
}

/** Percentage shown from a fraction, with the sign for a relative lift. */
export function percentOf(fraction: number): number {
  return Math.round(fraction * 100);
}
