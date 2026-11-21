import { describe, it, expect } from "vitest";
import { KbService, KbForbiddenError, KbValidationError } from "@/lib/ai/knowledge/service";
import { MemoryKbStore } from "@/lib/ai/knowledge/store";
import { MemoryAuditSink } from "@/lib/ai/audit";
import { searchEntries } from "@/lib/ai/knowledge/search";
import { makeClock, makeIds, OWNER } from "./helpers";
import type { KbEntry } from "@/lib/ai/knowledge/rules";

const AGENT = { kind: "agent" as const, agent: "CustomerSupportAgent" as const };

function kb() {
  const clock = makeClock("2026-11-20T09:00:00.000Z");
  const store = new MemoryKbStore();
  return { clock, store, service: new KbService({ store, audit: new MemoryAuditSink(), now: clock.now, newId: makeIds("k") }) };
}

const entry = (over: Partial<Parameters<KbService["save"]>[1]> = {}) => ({
  category: "customer_faq" as const,
  slug: "how-to-apply",
  language: "fr" as const,
  country: "all" as const,
  title: "Comment poser une demande",
  body: "Ouvrez le formulaire, puis joignez vos documents.",
  reliabilityStatus: "unverified" as const,
  tags: ["demande", "documents"],
  ...over,
});

describe("knowledge tags", () => {
  it("tags are lowercase labels; at most ten; anything else is refused", async () => {
    const { service } = kb();
    await expect(service.save(OWNER, entry({ tags: ["Visa Pro"] }))).rejects.toBeInstanceOf(KbValidationError);
    await expect(service.save(OWNER, entry({ tags: Array.from({ length: 11 }, (_, i) => `tag-${i}`) }))).rejects.toBeInstanceOf(KbValidationError);
    const saved = await service.save(OWNER, entry());
    expect(saved.tags).toEqual(["demande", "documents"]);
  });
});

describe("knowledge search (owner)", () => {
  const rows = [
    { ...entry(), id: "1", version: 1, createdBy: "o", updatedAt: "" } as KbEntry,
    { ...entry({ slug: "visa-docs", category: "visa_requirements", country: "dz", title: "Documents pour un visa", body: "Liste des pièces demandées.", tags: ["visa"], officialSourceUrl: "https://www.example-gov.dz/x", reliabilityStatus: "verified_official" as const, verifiedAt: "2026-11-01T00:00:00.000Z" }), id: "2", version: 1, createdBy: "o", updatedAt: "" } as KbEntry,
  ];

  it("every word of the text must appear in the title, body or tags", () => {
    expect(searchEntries(rows, { text: "documents visa" }).map((r) => r.id)).toEqual(["2"]);
    expect(searchEntries(rows, { text: "documents" }).map((r) => r.id).sort()).toEqual(["1", "2"]);
    expect(searchEntries(rows, { text: "introuvable" })).toEqual([]);
  });

  it("filters by category, country, reliability and tag", () => {
    expect(searchEntries(rows, { country: "dz" }).map((r) => r.id)).toEqual(["2"]);
    expect(searchEntries(rows, { category: "customer_faq" }).map((r) => r.id)).toEqual(["1"]);
    expect(searchEntries(rows, { reliability: "verified_official" }).map((r) => r.id)).toEqual(["2"]);
    expect(searchEntries(rows, { tag: "demande" }).map((r) => r.id)).toEqual(["1"]);
  });

  it("search and history are for the owner only", async () => {
    const { service } = kb();
    await expect(service.search(AGENT, { text: "x" })).rejects.toBeInstanceOf(KbForbiddenError);
    await expect(service.history(AGENT, "any")).rejects.toBeInstanceOf(KbForbiddenError);
    await expect(service.search(OWNER, { text: "x" })).resolves.toEqual([]);
  });
});

describe("knowledge version history", () => {
  it("an edit keeps the previous content; the history lists it, newest first", async () => {
    const { service, clock } = kb();
    const first = await service.save(OWNER, entry());
    clock.advance(60_000);
    await service.save(OWNER, entry({ body: "Texte corrigé : joignez aussi votre passeport." }));
    const history = await service.history(OWNER, first.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ version: 1, body: "Ouvrez le formulaire, puis joignez vos documents.", tags: ["demande", "documents"] });
  });

  it("a retired (archived) entry is no longer given to agents", async () => {
    const { service } = kb();
    const saved = await service.save(OWNER, entry({ category: "customer_faq" }));
    await service.review(OWNER, saved.id, "retire", null);
    const forAgent = await service.forAgent("CustomerSupportAgent", { country: "dz", language: "fr" });
    expect(forAgent.some((e) => e.title === saved.title)).toBe(false);
  });
});
