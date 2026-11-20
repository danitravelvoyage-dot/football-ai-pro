import { createHash } from "node:crypto";

/** JSON with keys sorted at every level, so the same value always produces the same text. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${entries.join(",")}}`;
}

/**
 * Fingerprint of the exact action an approval covers. The in-memory store uses this function.
 * The database uses its own fingerprint (migration 0007), which the database checks itself.
 */
export function payloadFingerprint(input: { actionClass: string; taskId: string; preview: unknown }): string {
  return createHash("sha256").update(`${input.actionClass}|${input.taskId}|${canonicalJson(input.preview)}`).digest("hex");
}
