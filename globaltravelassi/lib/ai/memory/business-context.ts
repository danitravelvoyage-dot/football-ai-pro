import { z } from "zod";
import type { Actor } from "../types";
import type { ContextService } from "../context/service";
import type { ContextEntry } from "../context/store";

/**
 * The business profile the platform needs. Each key holds the owner's own words. A key with no entry is
 * reported as missing. Nothing is filled in on the owner's behalf.
 */
export const BUSINESS_KEYS = [
  "company.goals",
  "company.target_markets",
  "company.service_priorities",
  "company.brand_guidelines",
  "company.pricing_policy",
  "company.communication_tone",
  "company.operational_constraints",
] as const;
export type BusinessKey = (typeof BUSINESS_KEYS)[number];

const profileValue = z.object({ text: z.string().min(1).max(2000) });

export class BusinessKeyError extends Error {
  constructor(key: string) {
    super(`"${key}" is not a business profile key.`);
    this.name = "BusinessKeyError";
  }
}

/** Saves one profile entry as owner text. Keys outside the registry are refused. */
export async function setBusinessEntry(
  context: ContextService,
  actor: Actor,
  key: string,
  text: string,
  expectedVersion: number,
): Promise<{ entryId: string; version: number }> {
  if (!(BUSINESS_KEYS as readonly string[]).includes(key)) throw new BusinessKeyError(key);
  const value = profileValue.parse({ text });
  return context.write(actor, { scope: "company", scopeKey: "company", contextKey: key, value, expectedVersion, visibility: "team", reason: "Business profile" });
}

export interface ProfileItem {
  key: BusinessKey;
  present: boolean;
  text: string | null;
  version: number | null;
}

/** Every registry key, in order. Missing keys stay missing. */
export function profileFrom(entries: ContextEntry[]): ProfileItem[] {
  return BUSINESS_KEYS.map((key) => {
    const entry = entries.find((e) => e.contextKey === key && e.scope === "company");
    const text = entry ? (entry.value as { text?: string }).text ?? null : null;
    return { key, present: text !== null, text, version: entry?.version ?? null };
  });
}
