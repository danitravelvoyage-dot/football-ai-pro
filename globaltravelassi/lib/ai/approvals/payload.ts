import { createHash } from "node:crypto";

/**
 * Canonical JSON contract. The database implements the same rules (migration 0007: ai_canonical_json).
 * Golden vectors in tests/fixtures/canonical-vectors.json must produce identical text in both.
 *
 *  - Objects: keys sorted by their UTF-8 bytes; keys whose value is undefined are omitted.
 *  - Arrays: kept in order; an undefined element becomes null.
 *  - Strings: escaped as follows and nothing else: " and \ are backslash-escaped; U+0008, U+0009, U+000A,
 *    U+000C, U+000D use \b \t \n \f \r; other code points below U+0020 use \u followed by four lowercase hex
 *    digits. Every other code point is written as is. Lone surrogates are refused.
 *  - Numbers: finite, written as plain decimal (no exponent), with -0 written as 0.
 *    Magnitudes at or above 1e21 and non-zero magnitudes below 1e-6 are refused.
 *  - true, false and null as their JSON words.
 */
export class CanonicalPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalPayloadError";
  }
}

const ESCAPES: Record<number, string> = { 8: "\\b", 9: "\\t", 10: "\\n", 12: "\\f", 13: "\\r" };

export function canonicalString(value: string): string {
  let out = '"';
  for (const ch of value) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0xd800 && cp <= 0xdfff) throw new CanonicalPayloadError("Lone surrogates cannot be stored.");
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ESCAPES[cp]) out += ESCAPES[cp];
    else if (cp < 0x20) out += `\\u${cp.toString(16).padStart(4, "0")}`;
    else out += ch;
  }
  return `${out}"`;
}

export function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) throw new CanonicalPayloadError("Numbers must be finite.");
  const magnitude = Math.abs(value);
  if (magnitude >= 1e21 || (magnitude !== 0 && magnitude < 1e-6)) {
    throw new CanonicalPayloadError("Number is outside the range the contract covers.");
  }
  return String(value === 0 ? 0 : value);
}

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return canonicalNumber(value);
  if (typeof value === "string") return canonicalString(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? "null" : canonicalJson(item))).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
    return `{${keys.map((key) => `${canonicalString(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new CanonicalPayloadError(`Values of type ${typeof value} cannot be stored.`);
}

/** sha256 over "action|task|canonical preview". The database computes the same value (migration 0007). */
export function payloadFingerprint(input: { actionClass: string; taskId: string; preview: unknown }): string {
  return createHash("sha256").update(`${input.actionClass}|${input.taskId}|${canonicalJson(input.preview)}`, "utf8").digest("hex");
}
