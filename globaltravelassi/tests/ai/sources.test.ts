import { describe, it, expect } from "vitest";
import { normalizeHost, checkExpiry, isUsable, revalidationDue, prioritize, SourceRuleError, checkCategory, checkJurisdiction } from "@/lib/ai/sources/rules";
import { SourceService, SourceForbiddenError, SourceConflictError, SourceRemovedError, type SourceRecord } from "@/lib/ai/sources/service";
import { MemorySourceStore } from "@/lib/ai/sources/memory-store";
import { MemoryAuditSink } from "@/lib/ai/audit";
import { makeClock, makeIds, OWNER } from "./helpers";

const AGENT = { kind: "agent" as const, agent: "MarketResearchAgent" as const };
const SYSTEM = { kind: "system" as const };
const NOW = "2026-11-21T09:00:00.000Z";
const DAY = 86_400_000;
const daysFrom = (n: number) => new Date(Date.parse(NOW) + n * DAY).toISOString();
const REASON = "Confirmed the official address";

describe("host rules", () => {
  it("accepts a bare host and lowercases it", () => {
    expect(normalizeHost(" Visa.Example.GOV.DZ ")).toBe("visa.example.gov.dz");
  });

  it.each([
    ["a URL", "https://visa.example.gov.dz"],
    ["a path", "visa.example.gov.dz/forms"],
    ["a port", "visa.example.gov.dz:8443"],
    ["a wildcard", "*.gov.dz"],
    ["an IP address", "192.168.1.10"],
    ["credentials", "user@visa.example.gov.dz"],
    ["a single label", "localhost"],
    ["an empty value", "   "],
  ])("refuses %s", (_label, value) => {
    expect(() => normalizeHost(value)).toThrow(SourceRuleError);
  });

  it("refuses unknown categories and jurisdictions", () => {
    expect(() => checkCategory("blog")).toThrow(SourceRuleError);
    expect(() => checkJurisdiction("us")).toThrow(SourceRuleError);
    expect(checkCategory("government")).toBe("government");
    expect(checkJurisdiction("dz")).toBe("dz");
  });

  it("an expiry must be a future date, and null means none", () => {
    expect(checkExpiry(null, NOW)).toBeNull();
    expect(checkExpiry(daysFrom(30), NOW)).toBe(daysFrom(30));
    expect(() => checkExpiry(daysFrom(-1), NOW)).toThrow(SourceRuleError);
    expect(() => checkExpiry("not a date", NOW)).toThrow(SourceRuleError);
  });
});

const facts = (over: Partial<SourceRecord> = {}): SourceRecord => ({
  host: "visa.example.gov.dz",
  version: 1,
  category: "government",
  jurisdiction: "dz",
  purpose: "Visa rules",
  status: "active",
  expiresAt: null,
  validatedAt: NOW,
  approvedBy: OWNER.id,
  approvedAt: NOW,
  updatedAt: NOW,
  lastChangeReason: null,
  ...over,
});

describe("usability and revalidation", () => {
  it("a disabled or expired host is not usable", () => {
    expect(isUsable(facts(), NOW)).toBe(true);
    expect(isUsable(facts({ status: "disabled" }), NOW)).toBe(false);
    expect(isUsable(facts({ expiresAt: daysFrom(-1) }), NOW)).toBe(false);
    expect(isUsable(facts({ expiresAt: daysFrom(1) }), NOW)).toBe(true);
  });

  it("a host never validated is due, and one validated over 90 days ago is due", () => {
    expect(revalidationDue(facts({ validatedAt: null }), NOW)).toBe(true);
    expect(revalidationDue(facts({ validatedAt: daysFrom(-89) }), NOW)).toBe(false);
    expect(revalidationDue(facts({ validatedAt: daysFrom(-91) }), NOW)).toBe(true);
  });

  it("official government sources come first, then the rest by name", () => {
    const ordered = prioritize([
      { host: "blog.example.com", category: "other" as const },
      { host: "b.gov.dz", category: "official_other" as const },
      { host: "a.gov.dz", category: "government" as const },
      { host: "immigration.dz", category: "immigration" as const },
      { host: "aa.example.com", category: "other" as const },
    ]);
    expect(ordered.map((s) => s.host)).toEqual(["a.gov.dz", "immigration.dz", "b.gov.dz", "aa.example.com", "blog.example.com"]);
  });
});

function setup() {
  const clock = makeClock(NOW);
  const audit = new MemoryAuditSink();
  const store = new MemorySourceStore();
  const svc = new SourceService({ store, audit, now: clock.now, newId: makeIds("src") });
  return { svc, store, audit, clock };
}

const addInput = (over: Partial<{ host: string; category: string; jurisdiction: string; purpose: string; expiresAt: string | null }> = {}) => ({
  host: "visa.example.gov.dz",
  category: "government",
  jurisdiction: "dz",
  purpose: "Visa rules",
  expiresAt: null,
  ...over,
});

describe("authorization", () => {
  it("refuses agents and the system from every registry action", async () => {
    const { svc } = setup();
    const row = await svc.add(OWNER, addInput(), REASON);
    for (const actor of [AGENT, SYSTEM]) {
      await expect(svc.list(actor)).rejects.toBeInstanceOf(SourceForbiddenError);
      await expect(svc.add(actor, addInput({ host: "other.gov.dz" }), REASON)).rejects.toBeInstanceOf(SourceForbiddenError);
      await expect(svc.edit(actor, row.host, row.version, { category: "other", jurisdiction: "all", purpose: "x y", expiresAt: null }, REASON)).rejects.toBeInstanceOf(SourceForbiddenError);
      await expect(svc.setStatus(actor, row.host, row.version, "disabled", REASON)).rejects.toBeInstanceOf(SourceForbiddenError);
      await expect(svc.remove(actor, row.host, row.version, REASON)).rejects.toBeInstanceOf(SourceForbiddenError);
    }
    expect((await svc.activeHosts())).toEqual([row.host]);
  });

  it("refuses an owner with an empty identity", async () => {
    const { svc } = setup();
    await expect(svc.add({ kind: "owner", id: " " }, addInput(), REASON)).rejects.toBeInstanceOf(SourceForbiddenError);
  });
});

describe("registry changes", () => {
  it("adds a host as active and audits the addition with the reason", async () => {
    const { svc, audit } = setup();
    const row = await svc.add(OWNER, addInput(), REASON);
    expect(row).toMatchObject({ status: "active", approvedBy: OWNER.id });
    const entry = audit.events.find((e) => e.type === "source.added");
    expect(entry).toMatchObject({ actor: `owner:${OWNER.id}`, entityId: "visa.example.gov.dz", meta: { reason: REASON, previous: null } });
  });

  it("refuses a duplicate host and a change without a reason", async () => {
    const { svc } = setup();
    await svc.add(OWNER, addInput(), REASON);
    await expect(svc.add(OWNER, addInput(), REASON)).rejects.toBeInstanceOf(SourceRuleError);
    await expect(svc.add(OWNER, addInput({ host: "two.gov.dz" }), "")).rejects.toBeInstanceOf(SourceRuleError);
  });

  it("edits metadata, and audits the previous and new values", async () => {
    const { svc, audit } = setup();
    const row = await svc.add(OWNER, addInput(), REASON);
    const edited = await svc.edit(OWNER, row.host, row.version, { category: "immigration", jurisdiction: "fr", purpose: "Consular rules", expiresAt: daysFrom(60) }, "Moved to the consular category");
    expect(edited).toMatchObject({ category: "immigration", jurisdiction: "fr", purpose: "Consular rules" });
    const entry = audit.events.find((e) => e.type === "source.updated")!;
    expect(entry.meta.previous).toMatchObject({ category: "government", jurisdiction: "dz" });
    expect(entry.meta.next).toMatchObject({ category: "immigration", jurisdiction: "fr" });
  });

  it("a stale edit is refused and changes nothing", async () => {
    const { svc } = setup();
    const row = await svc.add(OWNER, addInput(), REASON);
    await svc.setStatus(OWNER, row.host, row.version, "disabled", "Pending re-check");
    await expect(svc.edit(OWNER, row.host, row.version, { category: "other", jurisdiction: "all", purpose: "Stale write", expiresAt: null }, REASON)).rejects.toBeInstanceOf(SourceConflictError);
    const [current] = (await svc.list(OWNER)).filter((s) => s.host === row.host);
    expect(current!.purpose).toBe("Visa rules");
  });

  it("disabling a host removes it from agents' reads at once, and enabling restores it", async () => {
    const { svc } = setup();
    const row = await svc.add(OWNER, addInput(), REASON);
    const disabled = await svc.setStatus(OWNER, row.host, row.version, "disabled", "Source moved");
    expect(await svc.activeHosts()).toEqual([]);
    await svc.setStatus(OWNER, row.host, disabled.version, "active", "Source is back");
    expect(await svc.activeHosts()).toEqual([row.host]);
  });

  it("an expired host is not handed to agents, and revalidating records the date but not content", async () => {
    const { svc, clock, audit } = setup();
    const row = await svc.add(OWNER, addInput({ expiresAt: daysFrom(10) }), REASON);
    expect(await svc.activeHosts()).toEqual([row.host]);
    clock.advance(11 * DAY);
    expect(await svc.activeHosts()).toEqual([]);
    const shown = (await svc.list(OWNER))[0]!;
    expect(shown.usable).toBe(false);
    const again = await svc.revalidate(OWNER, row.host, row.version, "Re-checked the address");
    expect(again.validatedAt).toBe(daysFrom(11));
    expect(audit.events.some((e) => e.type === "source.revalidated")).toBe(true);
    expect(JSON.stringify(audit.events.find((e) => e.type === "source.revalidated"))).not.toContain("verified");
  });

  it("removes a host as a terminal status: the row stays, agents stop reading it, and nothing can change it again", async () => {
    const { svc, audit, store } = setup();
    const row = await svc.add(OWNER, addInput(), REASON);
    await svc.remove(OWNER, row.host, row.version, "Not used any more");
    expect(await svc.activeHosts()).toEqual([]);
    expect((await store.get(row.host))?.status).toBe("removed");
    expect(audit.events.find((e) => e.type === "source.removed")!.meta.previous).toMatchObject({ category: "government" });
    await expect(svc.setStatus(OWNER, row.host, row.version + 1, "active", REASON)).rejects.toBeInstanceOf(SourceRemovedError);
    await expect(svc.remove(OWNER, row.host, row.version + 1, REASON)).rejects.toBeInstanceOf(SourceRemovedError);
  });

  it("agents' read returns usable hosts only, official first, and never who approved them", async () => {
    const { svc } = setup();
    await svc.add(OWNER, addInput({ host: "zz-blog.example.com", category: "other" }), REASON);
    await svc.add(OWNER, addInput({ host: "visa.example.gov.dz", category: "government" }), REASON);
    const hosts = await svc.activeHosts();
    expect(hosts).toEqual(["visa.example.gov.dz", "zz-blog.example.com"]);
    expect(JSON.stringify(hosts)).not.toContain(OWNER.id);
  });
});
