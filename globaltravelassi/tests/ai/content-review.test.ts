import { describe, it, expect } from "vitest";
import { ContentReviewService, MemoryContentStore, ContentForbiddenError, ContentRuleError, ContentInputError, FEEDBACK_CONTEXT_KEY } from "@/lib/ai/content/review";
import { ContextService } from "@/lib/ai/context/service";
import { MemoryContextStore } from "@/lib/ai/context/store";
import { MemoryAuditSink } from "@/lib/ai/audit";
import { makeClock, makeIds, OWNER } from "./helpers";
import type { ArtifactRecord } from "@/lib/ai/orchestration/records";
import { CampaignService } from "@/lib/ai/campaigns/service";
import { MemoryCampaignStore } from "@/lib/ai/campaigns/memory-store";

const T = "2026-11-20T09:00:00.000Z";
const AGENT = { kind: "agent" as const, agent: "ContentCreatorAgent" as const };

function artifact(over: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    id: "art-1", taskId: "task-1", agent: "ContentCreatorAgent", kind: "caption", language: "fr", country: "dz",
    body: { text: "Un texte." }, status: "awaiting_owner", source: "mock", promptVersion: "1.0.0", createdAt: T, ...over,
  };
}

function setup(quality: { status: string; overall: number } | null = { status: "PASSED", overall: 88 }) {
  const clock = makeClock(T);
  const audit = new MemoryAuditSink();
  const store = new MemoryContentStore();
  const context = new ContextService({ store: new MemoryContextStore(), audit, now: clock.now, newId: makeIds("ctx") });
  const svc = new ContentReviewService({ store, context, audit, now: clock.now, newId: makeIds("rv"), latestQuality: async () => quality });
  return { svc, store, context, audit };
}

describe("content inbox and decisions", () => {
  it("the inbox lists pending content with its latest quality review, and only the owner sees it", async () => {
    const { svc, store } = setup({ status: "NEEDS_REVISION", overall: 61 });
    store.add(artifact());
    store.add(artifact({ id: "art-2", status: "approved" }));
    const items = await svc.inbox(OWNER);
    expect(items.map((i) => i.artifact.id)).toEqual(["art-1"]);
    expect(items[0]?.quality).toEqual({ status: "NEEDS_REVISION", overall: 61 });
    await expect(svc.inbox(AGENT)).rejects.toBeInstanceOf(ContentForbiddenError);
  });

  it("approval moves the item to approved and records it in the history", async () => {
    const { svc, store } = setup();
    store.add(artifact());
    const updated = await svc.decide(OWNER, "art-1", "approved", null);
    expect(updated.status).toBe("approved");
    const history = await svc.history(OWNER, "art-1");
    expect(history.map((h) => h.decision)).toEqual(["approved"]);
    expect(history[0]?.reviewer).toBe("owner-1");
  });

  it("a rejection or a revision needs a reason; approval does not", async () => {
    const { svc, store } = setup();
    store.add(artifact());
    await expect(svc.decide(OWNER, "art-1", "rejected", null)).rejects.toBeInstanceOf(ContentInputError);
    await expect(svc.decide(OWNER, "art-1", "revision_requested", "  ")).rejects.toBeInstanceOf(ContentInputError);
    await expect(svc.decide(OWNER, "art-1", "rejected", "Off-brand tone.")).resolves.toMatchObject({ status: "rejected" });
  });

  it("the same decision twice is refused, so the history stays meaningful", async () => {
    const { svc, store } = setup();
    store.add(artifact({ status: "approved" }));
    await expect(svc.decide(OWNER, "art-1", "approved", null)).rejects.toBeInstanceOf(ContentRuleError);
  });

  it("personal data in a note is refused", async () => {
    const { svc, store } = setup();
    store.add(artifact());
    await expect(svc.decide(OWNER, "art-1", "rejected", "Ask client@example.com about it.")).rejects.toBeInstanceOf(ContentInputError);
  });

  it("an agent cannot decide on content", async () => {
    const { svc, store } = setup();
    store.add(artifact());
    await expect(svc.decide(AGENT, "art-1", "approved", null)).rejects.toBeInstanceOf(ContentForbiddenError);
  });
});

describe("revision requests and agent memory", () => {
  it("a revision request sends the owner's note to the writing agent, and returns the item to draft", async () => {
    const { svc, store, context } = setup();
    store.add(artifact());
    const updated = await svc.decide(OWNER, "art-1", "revision_requested", "Shorter, and say what the price includes.");
    expect(updated.status).toBe("draft");
    const entries = await context.read(OWNER, { scope: "agent", scopeKey: "ContentCreatorAgent", limit: 10 });
    const feedback = entries.find((e) => e.contextKey === FEEDBACK_CONTEXT_KEY);
    expect(feedback?.value).toMatchObject({ artifactId: "art-1", note: "Shorter, and say what the price includes." });
  });

  it("a second revision request updates the same feedback entry, not a new one", async () => {
    const { svc, store, context } = setup();
    store.add(artifact());
    await svc.decide(OWNER, "art-1", "revision_requested", "First note here.");
    await svc.decide(OWNER, "art-1", "revision_requested", "Second note here.");
    const entries = (await context.read(OWNER, { scope: "agent", scopeKey: "ContentCreatorAgent", limit: 10 })).filter((e) => e.contextKey === FEEDBACK_CONTEXT_KEY);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.value).toMatchObject({ note: "Second note here." });
    expect(entries[0]?.version).toBe(2);
  });

  it("the feedback reaches the agent's shared context on its next run", async () => {
    const { svc, store, context } = setup();
    store.add(artifact());
    await svc.decide(OWNER, "art-1", "revision_requested", "Use a warmer opening line.");
    const forAgent = await context.forAgent("ContentCreatorAgent", null);
    expect(forAgent.some((e) => e.key === FEEDBACK_CONTEXT_KEY)).toBe(true);
  });
});

describe("campaign launch depends on the content review", () => {
  it("a campaign cannot launch while its content is awaiting review, and launches once approved", async () => {
    const clock = makeClock(T);
    const contentStore = new MemoryContentStore();
    contentStore.add(artifact());
    const campaigns = new CampaignService({
      store: new MemoryCampaignStore(),
      audit: new MemoryAuditSink(),
      now: clock.now,
      newId: makeIds("cp"),
      contentStatus: async (ids) => {
        const out = new Map<string, string>();
        for (const id of ids) {
          const a = await contentStore.get(id);
          if (a) out.set(id, a.status);
        }
        return out;
      },
    });
    const reviews = new ContentReviewService({ store: contentStore, context: new ContextService({ store: new MemoryContextStore(), audit: new MemoryAuditSink(), now: clock.now, newId: makeIds("x") }), audit: new MemoryAuditSink(), now: clock.now, newId: makeIds("rv"), latestQuality: async () => null });

    const c = await campaigns.create(OWNER, {
      name: "Spring push", goal: "Book spring consultations.", objective: "leads", kpis: [{ metric: "leads", target: 50 }],
      budgetMinor: 10000, currency: "DZD", channel: "whatsapp", country: "dz", language: "fr", startsOn: null, endsOn: null,
    });
    await campaigns.assignAgent(OWNER, c.id, "ContentCreatorAgent");
    await campaigns.assignContent(OWNER, c.id, "art-1");
    await expect(campaigns.transition(OWNER, c.id, "active")).rejects.toThrow("not approved");
    await reviews.decide(OWNER, "art-1", "approved", null);
    expect((await campaigns.transition(OWNER, c.id, "active")).status).toBe("active");
  });
});
