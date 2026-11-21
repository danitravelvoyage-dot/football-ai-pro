import "server-only";
import { cookies } from "next/headers";
import { decodeAttribution, LEAD_SOURCE_COOKIE, type Attribution } from "./lead-source";

/** The source recorded for this visitor when they first arrived. Null when the cookie is absent or blocked. */
export async function currentAttribution(): Promise<Attribution | null> {
  const store = await cookies();
  return decodeAttribution(store.get(LEAD_SOURCE_COOKIE)?.value);
}
