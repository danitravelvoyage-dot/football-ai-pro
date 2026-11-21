import { describe, it, expect } from "vitest";
import { fetchPublicPage, type HttpFetch } from "@/lib/ai/competitors/fetch";
import { MAX_PAGE_BYTES } from "@/lib/ai/competitors/rules";

const PAGE = "https://example.dz/prices";

/** A fake HTTP layer. Routes by URL; robots.txt defaults to 404 (allowed). */
function http(routes: Record<string, () => Response | Promise<Response>>): HttpFetch & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(url);
    const route = routes[url] ?? (url.endsWith("/robots.txt") ? () => new Response("", { status: 404 }) : () => new Response("", { status: 500 }));
    return route();
  }) as unknown as HttpFetch;
  return Object.assign(fn, { calls });
}

const html = (body: string, type = "text/html; charset=utf-8") => new Response(body, { status: 200, headers: { "content-type": type } });

describe("public page reads", () => {
  it("returns the page body when robots allows it and the page is HTML", async () => {
    const f = http({ [PAGE]: () => html("<p>Visa 45 EUR</p>") });
    const r = await fetchPublicPage(f, PAGE);
    expect(r).toEqual({ status: "ok", html: "<p>Visa 45 EUR</p>" });
  });

  it("identifies itself with a generic user agent and never follows redirects", async () => {
    const seen: Record<string, string>[] = [];
    const f = (async (url: string, init: { headers: Record<string, string>; redirect: string }) => {
      seen.push({ ...init.headers, redirect: init.redirect });
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      return new Response("", { status: 301, headers: { location: "https://other.example/" } });
    }) as unknown as HttpFetch;
    const r = await fetchPublicPage(f, PAGE);
    expect(r.status).toBe("redirect_refused");
    expect(seen.at(-1)?.redirect).toBe("manual");
    expect(seen.at(-1)?.["user-agent"]).toBe("GlobalTravelAssi-Monitor/1.0");
  });

  it("does not read a page that robots.txt disallows", async () => {
    const f = http({ "https://example.dz/robots.txt": () => html("User-agent: *\nDisallow: /prices", "text/plain"), [PAGE]: () => html("<p>x</p>") });
    const r = await fetchPublicPage(f, PAGE);
    expect(r.status).toBe("robots_disallowed");
    expect(f.calls).not.toContain(PAGE);
  });

  it("fails closed when robots.txt cannot be read because of a server error", async () => {
    const f = http({ "https://example.dz/robots.txt": () => new Response("", { status: 503 }), [PAGE]: () => html("<p>x</p>") });
    expect((await fetchPublicPage(f, PAGE)).status).toBe("fetch_failed");
    expect(f.calls).not.toContain(PAGE);
  });

  it("refuses non-HTML content", async () => {
    const f = http({ [PAGE]: () => new Response("%PDF", { status: 200, headers: { "content-type": "application/pdf" } }) });
    expect((await fetchPublicPage(f, PAGE)).status).toBe("not_html");
  });

  it("refuses a page declared larger than the limit", async () => {
    const f = http({ [PAGE]: () => new Response("x", { status: 200, headers: { "content-type": "text/html", "content-length": String(MAX_PAGE_BYTES + 1) } }) });
    expect((await fetchPublicPage(f, PAGE)).status).toBe("too_large");
  });

  it("stops reading a page that grows past the limit without declaring it", async () => {
    const big = new Uint8Array(MAX_PAGE_BYTES + 10);
    const f = http({ [PAGE]: () => new Response(big, { status: 200, headers: { "content-type": "text/html" } }) });
    expect((await fetchPublicPage(f, PAGE)).status).toBe("too_large");
  });

  it("reports a network failure as a status instead of throwing", async () => {
    const f = (async (url: string) => {
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      throw new Error("socket closed");
    }) as unknown as HttpFetch;
    expect((await fetchPublicPage(f, PAGE)).status).toBe("fetch_failed");
  });
});
