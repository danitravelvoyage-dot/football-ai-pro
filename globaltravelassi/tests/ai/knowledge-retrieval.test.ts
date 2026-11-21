import { describe, it, expect } from "vitest";
import { KbService } from "@/lib/ai/knowledge/service";
import { MemoryKbStore } from "@/lib/ai/knowledge/store";
import { MemoryAuditSink } from "@/lib/ai/audit";
import { rankEntries, termsOf } from "@/lib/ai/knowledge/ranking";
import { makeClock, makeIds, OWNER } from "./helpers";
import type { KbEntry } from "@/lib/ai/knowledge/rules";

const OFFICIAL = "https://www.example-gov.dz/visas";
const AGENT = "VisaResearchAgent" as const;

function kb() {
  const clock = makeClock("2026-11-21T09:00:00.000Z");
  const audit = new MemoryAuditSink();
  const service = new KbService({ store: new MemoryKbStore(), audit, now: clock.now, newId: makeIds("k") });
  return { service, audit, clock };
}

const base = { category: "customer_faq" as const, language: "fr" as const, country: "all" as const, body: "Texte de la fiche pour les demandes.", officialSourceUrl: null, verifiedAt: null, reliabilityStatus: "unverified" as const, tags: [] as string[] };

describe("relevance ranking (pure)", () => {
  it("terms of the objective are matched in the title, body and tags, in any script", () => {
    expect(termsOf("Demande de visa, Schengen 2026!")).toEqual(["demande", "visa", "schengen", "2026"]);
    expect(termsOf("تأشيرة الدخول")).toEqual(["تأشيرة", "الدخول"]);
  });

  it("an entry that matches the objective ranks above one that does not, and the reasons say why", () => {
    const now = new Date("2026-11-21T09:00:00.000Z");
    const entries = [
      { ...base, id: "a", slug: "a", version: 1, createdBy: "o", updatedAt: "", title: "Horaires du bureau", tags: [] } as KbEntry,
      { ...base, id: "b", slug: "b", version: 1, createdBy: "o", updatedAt: "", title: "Demande de visa Schengen", tags: ["visa"] } as KbEntry,
    ];
    const ranked = rankEntries(entries, { country: "dz", language: "fr", objective: "préparer une demande de visa" }, now);
    expect(ranked[0]?.entry.id).toBe("b");
    expect(ranked[0]?.reasons.some((r) => r.startsWith("terms:"))).toBe(true);
    expect(ranked[1]?.score).toBeLessThan(ranked[0]!.score);
  });

  it("a tag filter keeps only entries that share a tag with the query", () => {
    const now = new Date("2026-11-21T09:00:00.000Z");
    const entries = [
      { ...base, id: "a", slug: "a", version: 1, createdBy: "o", updatedAt: "", title: "Passeport", tags: ["documents"] } as KbEntry,
      { ...base, id: "b", slug: "b", version: 1, createdBy: "o", updatedAt: "", title: "Rendez-vous", tags: ["calendrier"] } as KbEntry,
    ];
    expect(rankEntries(entries, { country: "dz", language: "fr", tags: ["documents"] }, now).map((r) => r.entry.id)).toEqual(["a"]);
  });
});

describe("agent knowledge retrieval", () => {
  it("retrieval respects language and country context: other languages never reach the agent", async () => {
    const { service } = kb();
    // Only verified entries pass the freshness gate, so each fixture is verified first.
    const fr = await service.save(OWNER, { ...base, slug: "fr-entry", title: "Demande de visa" });
    await service.review(OWNER, fr.id, "verify_internal", null);
    const en = await service.save(OWNER, { ...base, slug: "en-entry", language: "en", title: "Visa request" });
    await service.review(OWNER, en.id, "verify_internal", null);
    const facts = await service.forAgent(AGENT, { country: "dz", language: "fr" });
    expect(facts.map((f) => f.title)).toEqual(["Demande de visa"]);
  });

  it("an entry for the agent's own country ranks above a general entry when the rest is equal", async () => {
    const { service } = kb();
    const general = await service.save(OWNER, { ...base, slug: "general", title: "Demande de visa", country: "all" });
    await service.review(OWNER, general.id, "verify_internal", null);
    const algeria = await service.save(OWNER, { ...base, slug: "algeria", title: "Demande de visa", country: "dz" });
    await service.review(OWNER, algeria.id, "verify_internal", null);
    const facts = await service.forAgent(AGENT, { country: "dz", language: "fr", objective: "demande visa" });
    expect(facts[0]?.country).toBe("dz");
  });

  it("source reliability: a verified official entry ranks above a verified internal one with the same match", async () => {
    const { service } = kb();
    const internal = await service.save(OWNER, { ...base, slug: "internal", title: "Demande de visa", reliabilityStatus: "unverified" });
    await service.review(OWNER, internal.id, "verify_internal", null);
    const official = await service.save(OWNER, { ...base, slug: "official", title: "Demande de visa" });
    await service.review(OWNER, official.id, "verify_official", OFFICIAL);
    const facts = await service.forAgent(AGENT, { country: "dz", language: "fr", objective: "demande visa" });
    expect(facts[0]?.reliability).toBe("verified_official");
  });

  it("tag-based retrieval returns only entries with the requested tag", async () => {
    const { service } = kb();
    const tagged = await service.save(OWNER, { ...base, slug: "tagged", title: "Documents requis", tags: ["documents"] });
    await service.review(OWNER, tagged.id, "verify_internal", null);
    const other = await service.save(OWNER, { ...base, slug: "other", title: "Horaires", tags: ["horaires"] });
    await service.review(OWNER, other.id, "verify_internal", null);
    const facts = await service.forAgent(AGENT, { country: "dz", language: "fr", tags: ["documents"] });
    expect(facts.map((f) => f.title)).toEqual(["Documents requis"]);
  });

  it("version awareness: the agent receives the current version, and the change is visible in history", async () => {
    const { service, clock } = kb();
    const saved = await service.save(OWNER, { ...base, slug: "versioned", title: "Demande de visa" });
    const verified = await service.review(OWNER, saved.id, "verify_internal", null);
    clock.advance(1000);
    const edited0 = await service.save(OWNER, { ...base, slug: "versioned", title: "Demande de visa", body: "Texte mis à jour avec la nouvelle liste." });
    // A changed entry is unverified again: the agent receives it only after the owner verifies the new content.
    expect(await service.forAgent(AGENT, { country: "dz", language: "fr", objective: "demande visa" })).toEqual([]);
    const edited = await service.review(OWNER, edited0.id, "verify_internal", null);
    const [fact] = await service.forAgent(AGENT, { country: "dz", language: "fr", objective: "demande visa" });
    expect(fact?.version).toBe(edited.version);
    expect(edited.version).toBeGreaterThan(verified.version);
    // Every replaced version is kept, newest first: the verified version 2 and the first version 1 are both there.
    const versions = (await service.history(OWNER, saved.id)).map((h) => h.version);
    expect(versions).toEqual([...versions].sort((a, b) => b - a));
    expect(versions).toEqual(expect.arrayContaining([1, verified.version]));
  });

  it("every retrieval is audited with entry ids and versions, and never with the entry text", async () => {
    const { service, audit } = kb();
    const saved0 = await service.save(OWNER, { ...base, slug: "audited", title: "Demande de visa secrète" });
    const saved = await service.review(OWNER, saved0.id, "verify_internal", null);
    await service.forAgent(AGENT, { country: "dz", language: "fr", objective: "demande visa" });
    const event = audit.events.find((e) => e.type === "kb.retrieved");
    expect(event?.actor).toBe(`agent:${AGENT}`);
    expect(event?.meta.entries).toEqual([{ id: saved.id, version: saved.version, score: expect.any(Number) }]);
    expect(JSON.stringify(event?.meta)).not.toContain("secrète");
  });

  it("a retired entry is never retrieved, even when it matches the objective", async () => {
    const { service } = kb();
    const saved = await service.save(OWNER, { ...base, slug: "retired", title: "Demande de visa" });
    await service.review(OWNER, saved.id, "retire", null);
    expect(await service.forAgent(AGENT, { country: "dz", language: "fr", objective: "demande visa" })).toEqual([]);
  });
});
