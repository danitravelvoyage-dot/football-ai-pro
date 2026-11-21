import { describe, it, expect } from "vitest";
import { CompetitorService, CompetitorForbiddenError, CompetitorValidationError } from "@/lib/ai/competitors/service";
import { MemoryCompetitorStore } from "@/lib/ai/competitors/memory-store";
import type { HttpFetch } from "@/lib/ai/competitors/fetch";
import { MemoryAuditSink } from "@/lib/ai/audit";
import { makeClock, makeIds, OWNER } from "./helpers";

const AGENT = { kind: "agent" as const, agent: "MarketResearchAgent" as const };
const SYSTEM = { kind: "system" as const };
const T = "2026-11-21T08:00:00.000Z";
const URL_PRICES = "https://example-travel.dz/prices";

/** Serves a page whose body the test can change between reads. robots.txt is 404 (allowed). */
function site(initial: string) {
  const state = { body: initial, status: 200, reads: 0 };
  const fetch = (async (url: string) => {
    if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
    state.reads += 1;
    if (state.status !== 200) return new Response("", { status: state.status });
    return new Response(state.body, { status: 200, headers: { "content-type": "text/html" } });
  }) as unknown as HttpFetch;
  return { fetch, state };
}

function setup(body = "<p>Schengen package 120 000 DZD</p>") {
  const clock = makeClock(T);
  const audit = new MemoryAuditSink();
  const s = site(body);
  const svc = new CompetitorService({ store: new MemoryCompetitorStore(), fetch: s.fetch, audit, now: clock.now, newId: makeIds("comp") });
  return { svc, clock, audit, site: s };
}

const source = (over: Record<string, unknown> = {}) => ({
  name: "Example Travel prices",
  url: URL_PRICES,
  kind: "pricing_page",
  purpose: "Track visa package prices",
  termsReviewed: true,
  minIntervalHours: 24,
  ...over,
});

describe("authorization", () => {
  it("refuses every action to agents and the system", async () => {
    const { svc } = setup();
    for (const actor of [AGENT, SYSTEM]) {
      await expect(svc.registerSource(actor, source())).rejects.toBeInstanceOf(CompetitorForbiddenError);
      await expect(svc.monitor(actor)).rejects.toBeInstanceOf(CompetitorForbiddenError);
      await expect(svc.report(actor)).rejects.toBeInstanceOf(CompetitorForbiddenError);
      await expect(svc.listSources(actor)).rejects.toBeInstanceOf(CompetitorForbiddenError);
    }
  });
});

describe("registration", () => {
  it("records who reviewed the terms and when", async () => {
    const { svc } = setup();
    const s = await svc.registerSource(OWNER, source());
    expect(s.termsReviewedBy).toBe(OWNER.id);
    expect(s.termsReviewedAt).toBe(T);
    expect(s.active).toBe(true);
  });

  it("refuses a source without reviewed terms", async () => {
    const { svc } = setup();
    await expect(svc.registerSource(OWNER, source({ termsReviewed: false }))).rejects.toBeInstanceOf(CompetitorValidationError);
  });

  it("refuses a URL that is not a public https page", async () => {
    const { svc } = setup();
    await expect(svc.registerSource(OWNER, source({ url: "http://example-travel.dz/prices" }))).rejects.toThrow(/not_https/);
    await expect(svc.registerSource(OWNER, source({ url: "https://10.1.2.3/" }))).rejects.toThrow(/ip_literal/);
  });

  it("refuses personal data in the name or purpose", async () => {
    const { svc } = setup();
    await expect(svc.registerSource(OWNER, source({ purpose: "Email me at owner@example.dz" }))).rejects.toBeInstanceOf(CompetitorValidationError);
  });
});

describe("monitoring", () => {
  it("records a first read as a baseline with no changes", async () => {
    const { svc } = setup();
    await svc.registerSource(OWNER, source());
    expect(await svc.monitor(OWNER)).toEqual({ checked: 1, skipped: 0, changed: 0, failed: 0 });
    const [r] = await svc.report(OWNER);
    expect(r?.latestStatus).toBe("ok");
    expect(r?.offerCount).toBe(1);
    expect(r?.lowestByCurrency).toEqual([{ currency: "DZD", amountMinor: 12000000 }]);
    expect(r?.changes).toEqual([]);
  });

  it("detects a price change on the next read and reports the opportunity", async () => {
    const { svc, clock, site: s } = setup();
    await svc.registerSource(OWNER, source());
    await svc.monitor(OWNER);
    s.state.body = "<p>Schengen package 135 000 DZD</p>";
    clock.advance(25 * 3_600_000);
    const summary = await svc.monitor(OWNER);
    expect(summary.changed).toBe(1);
    const [r] = await svc.report(OWNER);
    expect(r?.changes.map((c) => c.code)).toEqual(expect.arrayContaining(["content_changed", "lowest_price_up"]));
    expect(r?.opportunities).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "opportunity", code: "competitor_price_increase" })]));
  });

  it("does not read a source again before its interval has passed", async () => {
    const { svc, clock, site: s } = setup();
    await svc.registerSource(OWNER, source());
    await svc.monitor(OWNER);
    const readsAfterFirst = s.state.reads;
    clock.advance(2 * 3_600_000);
    expect(await svc.monitor(OWNER)).toEqual({ checked: 0, skipped: 1, changed: 0, failed: 0 });
    expect(s.state.reads).toBe(readsAfterFirst);
  });

  it("reads again after the interval, and an owner can force a read", async () => {
    const { svc, clock } = setup();
    await svc.registerSource(OWNER, source());
    await svc.monitor(OWNER);
    clock.advance(24 * 3_600_000);
    expect((await svc.monitor(OWNER)).checked).toBe(1);
    expect((await svc.monitor(OWNER, { force: true })).checked).toBe(1);
  });

  it("keeps a failed read in the history without treating it as a change", async () => {
    const { svc, clock, site: s } = setup();
    await svc.registerSource(OWNER, source());
    await svc.monitor(OWNER);
    s.state.status = 503;
    clock.advance(25 * 3_600_000);
    const summary = await svc.monitor(OWNER);
    expect(summary.failed).toBe(1);
    const [r] = await svc.report(OWNER);
    expect(r?.latestStatus).toBe("fetch_failed");
    expect(r?.changes).toEqual([]);
    expect(r?.offerCount).toBe(1); // the last successful read is still what the report shows
    s.state.status = 200;
    clock.advance(25 * 3_600_000);
    expect((await svc.monitor(OWNER)).changed).toBe(0);
  });

  it("does not compare against a failed read when looking for changes", async () => {
    const { svc, clock, site: s } = setup();
    await svc.registerSource(OWNER, source());
    await svc.monitor(OWNER);
    s.state.status = 500;
    clock.advance(25 * 3_600_000);
    await svc.monitor(OWNER);
    s.state.status = 200;
    s.state.body = "<p>Schengen package 120 000 DZD</p>";
    clock.advance(25 * 3_600_000);
    expect((await svc.monitor(OWNER)).changed).toBe(0);
  });

  it("skips paused sources", async () => {
    const { svc } = setup();
    const s = await svc.registerSource(OWNER, source());
    await svc.setActive(OWNER, s.id, false);
    expect(await svc.monitor(OWNER)).toEqual({ checked: 0, skipped: 0, changed: 0, failed: 0 });
  });

  it("audits every read with its status and change codes", async () => {
    const { svc, audit } = setup();
    await svc.registerSource(OWNER, source());
    await svc.monitor(OWNER);
    const read = audit.events.find((e) => e.type === "competitor.source_read");
    expect(read?.meta).toMatchObject({ status: "ok", changes: [] });
  });
});
