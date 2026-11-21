import { describe, it, expect } from "vitest";
import { ContextService, ContextForbiddenError, ContextValidationError } from "@/lib/ai/context/service";
import { MemoryContextStore, ContextVersionConflictError } from "@/lib/ai/context/store";
import { canRead, canWrite } from "@/lib/ai/context/policy";
import { MemoryAuditSink } from "@/lib/ai/audit";
import { KbService, KbForbiddenError, KB_SCAN_LIMIT } from "@/lib/ai/knowledge/service";
import { MemoryKbStore } from "@/lib/ai/knowledge/store";
import { freshnessOf, FRESHNESS_DAYS } from "@/lib/ai/knowledge/rules";
import { makeClock, makeIds, OWNER } from "./helpers";
import type { Actor } from "@/lib/ai/types";

const COO: Actor = { kind: "agent", agent: "COOAgent" };
const SALES: Actor = { kind: "agent", agent: "SalesAgent" };
const CRM: Actor = { kind: "agent", agent: "CRMAgent" };
const SYSTEM: Actor = { kind: "system" };
const RUN = "run-abcdef12";

function contextHarness() {
  const clock = makeClock();
  const audit = new MemoryAuditSink();
  const changes: number[] = [];
  const service = new ContextService({
    store: new MemoryContextStore(),
    audit,
    now: clock.now,
    newId: makeIds("c"),
    onChanged: async (c) => {
      changes.push(c.version);
    },
  });
  return { service, audit, changes, clock };
}

describe("context access rules", () => {
  const company = { scope: "company" as const, scopeKey: "company", visibility: "team" as const };
  const companyOwner = { ...company, visibility: "owner" as const };
  const agentOwn = { scope: "agent" as const, scopeKey: "SalesAgent", visibility: "team" as const };

  it("only the owner writes company context", () => {
    expect(canWrite(OWNER, company)).toBe(true);
    expect(canWrite(SALES, company)).toBe(false);
    expect(canWrite(SYSTEM, company)).toBe(false);
  });

  it("an agent reads team company context but never owner-only company context", () => {
    expect(canRead(SALES, company)).toBe(true);
    expect(canRead(SALES, companyOwner)).toBe(false);
    expect(canRead(OWNER, companyOwner)).toBe(true);
  });

  it("an agent reads and writes only its own agent scope", () => {
    expect(canRead(SALES, agentOwn)).toBe(true);
    expect(canRead(CRM, agentOwn)).toBe(false);
    expect(canWrite(SALES, agentOwn)).toBe(true);
    expect(canWrite(CRM, agentOwn)).toBe(false);
    expect(canRead(OWNER, agentOwn)).toBe(true);
  });

  it("only the COO writes workflow context, and only as team-visible", () => {
    const wf = { scope: "workflow" as const, scopeKey: RUN, visibility: "team" as const };
    expect(canWrite(COO, wf)).toBe(true);
    expect(canWrite(SALES, wf)).toBe(false);
    expect(canWrite(COO, { ...wf, visibility: "owner" })).toBe(false);
  });

  it("the system reads team-visible shared context only", () => {
    expect(canRead(SYSTEM, company)).toBe(true);
    expect(canRead(SYSTEM, companyOwner)).toBe(false);
    expect(canRead(SYSTEM, agentOwn)).toBe(false);
  });
});

describe("context service", () => {
  it("the owner writes company context at version 1, and it is recorded in the audit trail", async () => {
    const { service, audit, changes } = contextHarness();
    const result = await service.write(OWNER, {
      scope: "company",
      scopeKey: "company",
      contextKey: "company.positioning",
      value: { text: "Premium, factual travel support." },
      expectedVersion: 0,
      visibility: "team",
      reason: "Initial positioning",
    });
    expect(result.version).toBe(1);
    expect(audit.events.some((e) => e.type === "context.written" && e.entityId === result.entryId)).toBe(true);
    expect(changes).toEqual([1]);
  });

  it("an agent cannot write company context", async () => {
    const { service } = contextHarness();
    await expect(
      service.write(SALES, { scope: "company", scopeKey: "company", contextKey: "company.pricing", value: { text: "x" }, expectedVersion: 0, visibility: "team" }),
    ).rejects.toBeInstanceOf(ContextForbiddenError);
  });

  it("a stale write is refused, and the history keeps every version", async () => {
    const { service } = contextHarness();
    const base = { scope: "company" as const, scopeKey: "company", contextKey: "company.offer", visibility: "team" as const };
    await service.write(OWNER, { ...base, value: { text: "v1" }, expectedVersion: 0 });
    await service.write(OWNER, { ...base, value: { text: "v2" }, expectedVersion: 1 });
    await expect(service.write(OWNER, { ...base, value: { text: "stale" }, expectedVersion: 1 })).rejects.toBeInstanceOf(ContextVersionConflictError);
    const [entry] = await service.read(OWNER, { scope: "company", scopeKey: "company", limit: 10 });
    expect(entry.version).toBe(2);
  });

  it("refuses personal data, bad keys, unknown agents and oversized values", async () => {
    const { service } = contextHarness();
    const base = { scope: "company" as const, scopeKey: "company", contextKey: "company.note", visibility: "team" as const, expectedVersion: 0 };
    await expect(service.write(OWNER, { ...base, value: { text: "Call owner@example.dz" } })).rejects.toBeInstanceOf(ContextValidationError);
    await expect(service.write(OWNER, { ...base, contextKey: "Bad Key", value: { text: "x" } })).rejects.toThrow("format");
    await expect(service.write(OWNER, { ...base, scope: "company", scopeKey: "other", value: { text: "x" } })).rejects.toThrow("company scope key");
    await expect(service.write(OWNER, { ...base, scope: "agent", scopeKey: "NotAnAgent", value: { text: "x" } })).rejects.toThrow("must name an agent");
    await expect(service.write(OWNER, { ...base, value: { text: "x".repeat(17_000) } })).rejects.toThrow("too large");
    await expect(service.write(OWNER, { ...base, value: [] as never })).rejects.toThrow("must be an object");
  });

  it("an agent's prompt context holds shared company and run context and its own scope, and nothing else", async () => {
    const { service } = contextHarness();
    await service.write(OWNER, { scope: "company", scopeKey: "company", contextKey: "company.team", value: { text: "shared" }, expectedVersion: 0, visibility: "team" });
    await service.write(OWNER, { scope: "company", scopeKey: "company", contextKey: "company.private", value: { text: "owner only" }, expectedVersion: 0, visibility: "owner" });
    await service.write(COO, { scope: "workflow", scopeKey: RUN, contextKey: "workflow.brief", value: { text: "run brief" }, expectedVersion: 0, visibility: "team" });
    await service.write(COO, { scope: "workflow", scopeKey: "run-other-99", contextKey: "workflow.brief", value: { text: "other run" }, expectedVersion: 0, visibility: "team" });
    await service.write(SALES, { scope: "agent", scopeKey: "SalesAgent", contextKey: "agent.sales.notes", value: { text: "own note" }, expectedVersion: 0, visibility: "team" });
    await service.write(CRM, { scope: "agent", scopeKey: "CRMAgent", contextKey: "agent.crm.notes", value: { text: "crm note" }, expectedVersion: 0, visibility: "team" });

    const forSales = await service.forAgent("SalesAgent", RUN);
    const keys = forSales.map((c) => c.key).sort();
    expect(keys).toEqual(["agent.sales.notes", "company.team", "workflow.brief"]);
    expect(JSON.stringify(forSales)).not.toContain("owner only");
    expect(JSON.stringify(forSales)).not.toContain("crm note");
    expect(JSON.stringify(forSales)).not.toContain("other run");
  });

  it("an agent cannot read another agent's scope through the service", async () => {
    const { service } = contextHarness();
    await service.write(CRM, { scope: "agent", scopeKey: "CRMAgent", contextKey: "agent.crm.notes", value: { text: "crm" }, expectedVersion: 0, visibility: "team" });
    expect(await service.read(SALES, { scope: "agent", scopeKey: "CRMAgent", limit: 10 })).toHaveLength(0);
    expect(await service.read(CRM, { scope: "agent", scopeKey: "CRMAgent", limit: 10 })).toHaveLength(1);
  });
});

function kbHarness() {
  const clock = makeClock("2026-11-20T09:00:00.000Z");
  const audit = new MemoryAuditSink();
  const service = new KbService({ store: new MemoryKbStore(), audit, now: clock.now, newId: makeIds("k") });
  return { service, audit, clock };
}

const OFFICIAL = "https://www.example-gov.dz/visas";
const verifiedDaysAgo = (clock: { now: () => Date }, days: number) => new Date(clock.now().getTime() - days * 86_400_000).toISOString();

describe("knowledge base rules", () => {
  it("freshness is decided by the reliability status and the verification date", () => {
    const now = new Date("2026-11-20T09:00:00.000Z");
    const recent = new Date(now.getTime() - 10 * 86_400_000).toISOString();
    const old = new Date(now.getTime() - (FRESHNESS_DAYS.verified_official + 5) * 86_400_000).toISOString();
    expect(freshnessOf({ reliabilityStatus: "verified_official", verifiedAt: recent }, now)).toBe("current");
    expect(freshnessOf({ reliabilityStatus: "verified_official", verifiedAt: old }, now)).toBe("stale");
    expect(freshnessOf({ reliabilityStatus: "unverified", verifiedAt: null }, now)).toBe("not_verified");
    expect(freshnessOf({ reliabilityStatus: "disputed", verifiedAt: recent }, now)).toBe("excluded");
    expect(freshnessOf({ reliabilityStatus: "retired", verifiedAt: recent }, now)).toBe("excluded");
  });
});

describe("knowledge base service", () => {
  it("visa facts need an official https source, even while unverified", async () => {
    const { service } = kbHarness();
    await expect(
      service.save(OWNER, { category: "visa_requirements", slug: "fr-visa", language: "fr", country: "dz", title: "Visa France", body: "Exigences à confirmer.", reliabilityStatus: "unverified" }),
    ).rejects.toThrow("official source");
    await expect(
      service.save(OWNER, { category: "visa_requirements", slug: "fr-visa", language: "fr", country: "dz", title: "Visa France", body: "Exigences à confirmer.", officialSourceUrl: "http://insecure.example/visa", reliabilityStatus: "unverified" }),
    ).rejects.toThrow("https");
  });

  it("verified_official needs a date as well as a source", async () => {
    const { service } = kbHarness();
    await expect(
      service.save(OWNER, { category: "country_information", slug: "dz-docs", language: "fr", country: "dz", title: "Documents", body: "Liste à vérifier.", officialSourceUrl: OFFICIAL, reliabilityStatus: "verified_official" }),
    ).rejects.toThrow("date");
  });

  it("refuses personal data in an entry", async () => {
    const { service } = kbHarness();
    await expect(
      service.save(OWNER, { category: "customer_faq", slug: "faq-1", language: "fr", country: "all", title: "Question", body: "Écrire à client@example.dz", reliabilityStatus: "unverified" }),
    ).rejects.toThrow("personal data");
  });

  it("only the owner writes or reviews entries", async () => {
    const { service } = kbHarness();
    await expect(
      service.save(SALES, { category: "customer_faq", slug: "faq-2", language: "fr", country: "all", title: "Question", body: "Réponse de test à relire.", reliabilityStatus: "unverified" }),
    ).rejects.toBeInstanceOf(KbForbiddenError);
  });

  it("an unverified entry is never given to an agent as fact", async () => {
    const { service } = kbHarness();
    await service.save(OWNER, { category: "visa_requirements", slug: "fr-visa-dz", language: "fr", country: "dz", title: "Visa France", body: "Exigences à confirmer.", officialSourceUrl: OFFICIAL, reliabilityStatus: "unverified" });
    expect(await service.forAgent("VisaResearchAgent", { country: "dz", language: "fr" })).toEqual([]);
  });

  it("the owner verifies an entry, and then the visa agent can use it with its source and date", async () => {
    const { service } = kbHarness();
    const saved = await service.save(OWNER, { category: "visa_requirements", slug: "fr-visa-dz", language: "fr", country: "dz", title: "Visa France", body: "Exigences à confirmer auprès de la source officielle.", officialSourceUrl: OFFICIAL, reliabilityStatus: "unverified" });
    await service.review(OWNER, saved.id, "verify_official", null);
    const facts = await service.forAgent("VisaResearchAgent", { country: "dz", language: "fr" });
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ reliability: "verified_official", officialSourceUrl: OFFICIAL });
    expect(facts[0].verifiedAt).toBeTruthy();
  });

  it("a stale official fact is withheld from agents", async () => {
    const { service, clock } = kbHarness();
    const saved = await service.save(OWNER, { category: "visa_requirements", slug: "fr-visa-dz", language: "fr", country: "dz", title: "Visa France", body: "Exigences à confirmer auprès de la source officielle.", officialSourceUrl: OFFICIAL, verifiedAt: verifiedDaysAgo(clock, 120), reliabilityStatus: "verified_official" });
    expect(saved.reliabilityStatus).toBe("verified_official");
    expect(await service.forAgent("VisaResearchAgent", { country: "dz", language: "fr" })).toEqual([]);
  });

  it("disputed and retired entries are withheld; a dispute takes effect at once", async () => {
    const { service } = kbHarness();
    const saved = await service.save(OWNER, { category: "visa_requirements", slug: "fr-visa-dz", language: "fr", country: "dz", title: "Visa France", body: "Exigences à confirmer auprès de la source officielle.", officialSourceUrl: OFFICIAL, reliabilityStatus: "unverified" });
    await service.review(OWNER, saved.id, "verify_official", null);
    expect(await service.forAgent("VisaResearchAgent", { country: "dz", language: "fr" })).toHaveLength(1);
    await service.review(OWNER, saved.id, "dispute", null);
    expect(await service.forAgent("VisaResearchAgent", { country: "dz", language: "fr" })).toEqual([]);
  });

  it("country and language must match exactly; 'all' entries apply to every country", async () => {
    const { service } = kbHarness();
    const base = { category: "service_catalogue" as const, language: "fr" as const, title: "Service", body: "Service à présenter avec prudence.", reliabilityStatus: "verified_internal" as const };
    const verifiedNow = "2026-11-19T09:00:00.000Z";
    await service.save(OWNER, { ...base, slug: "dz-only", country: "dz", verifiedAt: verifiedNow });
    await service.save(OWNER, { ...base, slug: "all-countries", country: "all", verifiedAt: verifiedNow });
    await service.save(OWNER, { ...base, slug: "arabic-only", language: "ar", country: "all", title: "خدمة", body: "خدمة تعرض بعناية.", verifiedAt: verifiedNow });

    const forMorocco = await service.forAgent("VisaResearchAgent", { country: "ma", language: "fr" });
    expect(forMorocco.map((f) => f.title)).toEqual(["Service"]);
    const forAlgeria = await service.forAgent("VisaResearchAgent", { country: "dz", language: "fr" });
    expect(forAlgeria).toHaveLength(2);
  });

  it("an agent without the knowledge-read tool gets nothing", async () => {
    const { service } = kbHarness();
    await service.save(OWNER, { category: "customer_faq", slug: "faq-3", language: "fr", country: "all", title: "Question", body: "Réponse vérifiée en interne.", reliabilityStatus: "verified_internal", verifiedAt: "2026-11-19T09:00:00.000Z" });
    expect(await service.forAgent("COOAgent", { country: "dz", language: "fr" })).toEqual([]);
  });

  it("a query over an oversized knowledge base fails instead of answering with partial facts", async () => {
    const { service } = kbHarness();
    const store = (service as unknown as { deps: { store: MemoryKbStore } }).deps.store;
    for (let i = 0; i < KB_SCAN_LIMIT; i++) {
      await store.insert({ category: "customer_faq", slug: `faq-${i}`, language: "fr", country: "all", title: "Question", body: "Réponse de test à relire.", officialSourceUrl: null, verifiedAt: null, reliabilityStatus: "unverified", tags: [] }, "owner:owner-1", new Date().toISOString());
    }
    await expect(service.forAgent("VisaResearchAgent", { country: "dz", language: "fr" })).rejects.toThrow("too large");
  });

  it("every change is recorded in the audit trail", async () => {
    const { service, audit } = kbHarness();
    const saved = await service.save(OWNER, { category: "content_policies", slug: "policy-1", language: "fr", country: "all", title: "Politique", body: "Aucune promesse de résultat.", reliabilityStatus: "unverified" });
    await service.review(OWNER, saved.id, "verify_internal", null);
    expect(audit.events.map((e) => e.type)).toEqual(["kb.created", "kb.reviewed"]);
    expect(audit.events[1].meta.reliability).toBe("verified_internal");
  });
});
