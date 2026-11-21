import { MAX_PAGE_BYTES, type ObservationStatus } from "./rules";

/**
 * Reads one public page for competitor monitoring. It never follows redirects (the owner registers the final URL),
 * it honours robots.txt for the generic user agent, and it refuses pages that are too large, not HTML or too slow.
 * Failures are returned as statuses, never thrown, so one bad source cannot stop a monitoring run.
 */

export const MONITOR_USER_AGENT = "GlobalTravelAssi-Monitor/1.0";
const TIMEOUT_MS = 15_000;

export type HttpFetch = (url: string, init: { headers: Record<string, string>; redirect: "manual"; signal: AbortSignal }) => Promise<Response>;

export interface PageResult {
  status: ObservationStatus;
  /** Visible text of the page, present only when status is ok. */
  html?: string;
}

/** Parses robots.txt for the generic group ("*") and our own agent name. Longest matching rule wins; Allow beats Disallow on a tie. */
export function robotsAllows(robotsTxt: string, path: string): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let current: { agents: string[]; rules: { allow: boolean; path: string }[] } | null = null;
  let lastWasAgent = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "disallow") current.rules.push({ allow: false, path: value });
    if (field === "allow") current.rules.push({ allow: true, path: value });
  }

  const ours = MONITOR_USER_AGENT.toLowerCase().split("/")[0] ?? "";
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && ours.includes(a)));
  const generic = groups.filter((g) => g.agents.includes("*"));
  const applicable = specific.length > 0 ? specific : generic;
  let best: { allow: boolean; path: string } | null = null;
  for (const g of applicable) {
    for (const r of g.rules) {
      if (r.path === "" && !r.allow) continue; // an empty Disallow allows everything
      if (!path.startsWith(r.path)) continue;
      if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
    }
  }
  return best ? best.allow : true;
}

async function get(fetchImpl: HttpFetch, url: string, accept: string): Promise<Response | "timeout"> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetchImpl(url, { headers: { "user-agent": MONITOR_USER_AGENT, accept }, redirect: "manual", signal: controller.signal });
  } catch {
    return "timeout";
  } finally {
    clearTimeout(timer);
  }
}

/** Reads robots.txt. A missing file means everything is allowed. A server error or timeout fails closed. */
async function robotsStatus(fetchImpl: HttpFetch, url: URL): Promise<"allowed" | "disallowed" | "unavailable"> {
  const res = await get(fetchImpl, `${url.origin}/robots.txt`, "text/plain");
  if (res === "timeout") return "unavailable";
  if (res.status === 404 || res.status === 410) return "allowed";
  if (res.status >= 300 && res.status < 400) return "unavailable";
  if (res.status !== 200) return "unavailable";
  const text = (await res.text()).slice(0, MAX_PAGE_BYTES);
  return robotsAllows(text, url.pathname + url.search) ? "allowed" : "disallowed";
}

async function readCapped(res: Response): Promise<string | "too_large"> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_PAGE_BYTES) return "too_large";
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PAGE_BYTES) {
      await reader.cancel();
      return "too_large";
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
}

/** Fetches one checked public URL. `url` must already have passed checkSourceUrl. */
export async function fetchPublicPage(fetchImpl: HttpFetch, url: string): Promise<PageResult> {
  const parsed = new URL(url);
  const robots = await robotsStatus(fetchImpl, parsed);
  if (robots === "disallowed") return { status: "robots_disallowed" };
  if (robots === "unavailable") return { status: "fetch_failed" };

  const res = await get(fetchImpl, url, "text/html, text/plain;q=0.8");
  if (res === "timeout") return { status: "fetch_failed" };
  if (res.status >= 300 && res.status < 400) return { status: "redirect_refused" };
  if (res.status !== 200) return { status: "fetch_failed" };
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  if (!type.includes("text/html") && !type.includes("text/plain")) return { status: "not_html" };
  const body = await readCapped(res);
  if (body === "too_large") return { status: "too_large" };
  return { status: "ok", html: body };
}
