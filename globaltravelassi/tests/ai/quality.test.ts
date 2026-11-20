import { describe, it, expect } from "vitest";
import { QualityController, QualityForbiddenError } from "@/lib/ai/quality/controller";
import { MemoryQualityStore } from "@/lib/ai/quality/store";
import { MemoryAuditSink } from "@/lib/ai/audit";
import { outputSchemas } from "@/lib/ai/registry";
import { DEFAULT_QUALITY_CONFIG, type ScoringWeights } from "@/lib/ai/quality/types";
import { scoringWeightsSchema } from "@/lib/ai/quality/types";
import { applyRevisionLimit } from "@/lib/ai/quality/revision";
import { hostOf } from "@/lib/ai/quality/checks";
import { makeClock, makeIds } from "./helpers";

const ALLOW = ["www.diplomatie.gouv.fr"];
const TODAY = "2026-11-15";

function controller(overrides: Partial<typeof DEFAULT_QUALITY_CONFIG> = {}) {
  const clock = makeClock("2026-11-20T09:00:00.000Z");
  const store = new MemoryQualityStore();
  const audit = new MemoryAuditSink();
  const qc = new QualityController({ store, audit, now: clock.now, newId: makeIds("q"), config: { ...DEFAULT_QUALITY_CONFIG, ...overrides } });
  return { qc, store, audit, clock };
}

const research = (findings: unknown[]) => ({ findings });
const finding = (over: Record<string, unknown> = {}) => ({ insight: "Demand is rising.", evidence: "Monthly bookings grew.", confidence: "low", sources: [], ...over });
const visa = (requirements: unknown[]) => ({ requirements });
const req = (over: Record<string, unknown> = {}) => ({
  destination: "France",
  item: "Passport valid for three months after the return date",
  source_url: "https://www.diplomatie.gouv.fr/fr/services-aux-etrangers",
  last_checked: TODAY,
  verified_by_official_source: true,
  ...over,
});

function review(qc: QualityController, outputKind: "research" | "visa" | "content" | "analytics", output: unknown, extra: Partial<Parameters<QualityController["review"]>[0]> = {}) {
  const schema = outputSchemas[outputKind];
  return qc.review({ taskId: "t1", runId: "r1", agent: "X", outputKind, output, schema, language: "fr", allowlist: ALLOW, attempt: 1, ...extra });
}

describe("output validation", () => {
  it("a valid output passes", () => {
    const { qc } = controller();
    const r = review(qc, "research", research([finding({ confidence: "low" })]));
    expect(r.status).toBe("PASSED");
    expect(r.overall).toBeGreaterThanOrEqual(70);
  });

  it("a malformed output is rejected", () => {
    const { qc } = controller();
    const r = review(qc, "research", { findings: "not a list" });
    expect(r.status).toBe("REJECTED");
    expect(r.issues.some((i) => i.code === "schema_failure")).toBe(true);
  });

  it("a missing required field is rejected as missing", () => {
    const { qc } = controller();
    const r = review(qc, "content", { drafts: [{ kind: "caption", text: "Hello" }] });
    expect(r.status).toBe("REJECTED");
    expect(r.issues.some((i) => i.code === "missing_required_field")).toBe(true);
  });

  it("an empty list is flagged as a warning, not rejected", () => {
    const { qc } = controller();
    const r = review(qc, "visa", visa([]));
    expect(r.issues.some((i) => i.code === "empty_output")).toBe(true);
    expect(r.status).toBe("PASSED");
  });
});

describe("source verification", () => {
  it("an official source on the allowlist, checked recently, is accepted", () => {
    const { qc } = controller();
    expect(review(qc, "visa", visa([req()])).status).toBe("PASSED");
  });

  it("a factual claim from a source off the allowlist needs human review", () => {
    const { qc } = controller();
    const r = review(qc, "visa", visa([req({ source_url: "https://example-agency.com/visa" })]));
    expect(r.status).toBe("REQUIRES_HUMAN_REVIEW");
    expect(r.issues.some((i) => i.code === "unverifiable_claim")).toBe(true);
  });

  it("a factual claim with no source needs human review", () => {
    const { qc } = controller();
    const r = review(qc, "visa", visa([req({ source_url: "" })]));
    expect(r.status).not.toBe("PASSED");
  });

  it("an http source is an invalid source", () => {
    expect(hostOf("http://www.diplomatie.gouv.fr/x")).toBeNull();
    expect(hostOf("not a url")).toBeNull();
    expect(hostOf("https://www.diplomatie.gouv.fr/x")).toBe("www.diplomatie.gouv.fr");
  });

  it("a stale official source needs a revision", () => {
    const { qc } = controller();
    const r = review(qc, "visa", visa([req({ last_checked: "2026-01-01" })]));
    expect(r.issues.some((i) => i.code === "stale_source")).toBe(true);
    expect(r.status).toBe("NEEDS_REVISION");
  });

  it("an undated source needs a revision", () => {
    const { qc } = controller();
    const r = review(qc, "visa", visa([req({ last_checked: "not-a-date" })]));
    expect(r.issues.some((i) => i.code === "undated_source")).toBe(true);
  });
});

describe("unsupported claims and content", () => {
  it("a confident claim without a source needs a revision", () => {
    const { qc } = controller();
    const r = review(qc, "research", research([finding({ confidence: "high", sources: [] })]));
    expect(r.status).toBe("NEEDS_REVISION");
    expect(r.issues.some((i) => i.code === "unsupported_claim")).toBe(true);
    expect(r.feedback.some((f) => f.code === "unsupported_claim" && f.path === "findings[0]")).toBe(true);
  });

  it("a low-confidence claim without a source is flagged as uncertain, and still passes", () => {
    const { qc } = controller();
    const r = review(qc, "research", research([finding({ confidence: "low" })]));
    expect(r.issues.some((i) => i.code === "uncertain_claim")).toBe(true);
    expect(r.status).toBe("PASSED");
  });

  it("a promise of a guaranteed visa is a blocking brand violation", () => {
    const { qc } = controller();
    const r = review(qc, "content", { drafts: [{ kind: "caption", language: "en", text: "Guaranteed visa approval in one week!" }] });
    expect(r.issues.some((i) => i.code === "brand_violation" && i.severity === "blocking")).toBe(true);
    expect(r.status).toBe("NEEDS_REVISION");
  });

  it("the deterministic compliance rules run on every text", () => {
    const { qc } = controller();
    const r = review(qc, "content", { drafts: [{ kind: "caption", language: "fr", text: "Visa garanti à 100 % avec nous !" }] });
    expect(r.issues.some((i) => i.code.startsWith("policy_"))).toBe(true);
    expect(r.status).toBe("NEEDS_REVISION");
  });

  it("an Arabic request with French text is a language mismatch", () => {
    const { qc } = controller();
    const r = review(qc, "content", { drafts: [{ kind: "post", language: "fr", text: "Bonjour, voici notre offre pour les voyageurs de demain." }] }, { language: "ar" });
    expect(r.issues.some((i) => i.code === "language_mismatch")).toBe(true);
  });

  it("the same text twice in one output is a duplicate", () => {
    const { qc } = controller();
    const text = "Découvrez nos services de visa pour la France.";
    const r = review(qc, "content", { drafts: [{ kind: "post", language: "fr", text }, { kind: "post", language: "fr", text }] });
    expect(r.issues.some((i) => i.code === "duplicate_content")).toBe(true);
  });

  it("placeholder wording is flagged", () => {
    const { qc } = controller();
    const r = review(qc, "content", { drafts: [{ kind: "post", language: "en", text: "Mock draft. Review before use." }] });
    expect(r.issues.some((i) => i.code === "placeholder_content")).toBe(true);
  });
});

describe("conflicting agent results", () => {
  it("two agents disagree on a visa requirement: a critical conflict needs human review", () => {
    const { qc } = controller();
    const peer = { key: "visa:France|passport valid for three months after the return date", producer: "VisaResearchAgent", category: "visa" as const, confidence: "high" as const, sourceUrl: null, checkedAt: null, official: false, path: "requirements[0]", value: "six months" };
    const r = review(qc, "visa", visa([req({ item: "Passport valid for three months after the return date" })]), { peerClaims: [peer] });
    expect(r.issues.some((i) => i.code === "conflicting_claims" && i.severity === "critical")).toBe(true);
    expect(r.status).toBe("REQUIRES_HUMAN_REVIEW");
  });

  it("agreeing peers are not a conflict", () => {
    const { qc } = controller();
    const peer = { key: "visa:France|passport valid for three months after the return date", producer: "VisaResearchAgent", category: "visa" as const, confidence: "high" as const, sourceUrl: null, checkedAt: null, official: false, path: "requirements[0]", value: "Passport valid for three months after the return date" };
    const r = review(qc, "visa", visa([req({ item: "Passport valid for three months after the return date" })]), { peerClaims: [peer] });
    expect(r.issues.some((i) => i.code === "conflicting_claims")).toBe(false);
  });
});

describe("scoring and configuration", () => {
  it("weights must add up to one", () => {
    const bad: ScoringWeights = { schema_validity: 0.5, factual_support: 0.5, completeness: 0.5, source_reliability: 0, policy_compliance: 0 };
    expect(scoringWeightsSchema.safeParse(bad).success).toBe(false);
    expect(scoringWeightsSchema.safeParse(DEFAULT_QUALITY_CONFIG.weights).success).toBe(true);
  });

  it("changing the weights changes the overall score", () => {
    const heavyCompleteness: ScoringWeights = { schema_validity: 0, factual_support: 0, completeness: 1, source_reliability: 0, policy_compliance: 0 };
    const a = controller();
    const b = controller({ weights: heavyCompleteness });
    const output = visa([]);
    expect(review(a.qc, "visa", output).overall).not.toBe(review(b.qc, "visa", output).overall);
  });
});

describe("revision limit and history", () => {
  it("a revision request beyond the allowed attempts becomes a rejection", () => {
    expect(applyRevisionLimit("NEEDS_REVISION", 1, 2)).toBe("NEEDS_REVISION");
    expect(applyRevisionLimit("NEEDS_REVISION", 2, 2)).toBe("NEEDS_REVISION");
    expect(applyRevisionLimit("NEEDS_REVISION", 3, 2)).toBe("REJECTED");
    expect(applyRevisionLimit("PASSED", 9, 2)).toBe("PASSED");
  });

  it("each attempt is recorded, in order, and the record holds codes and locations, not the text", async () => {
    const { qc, store } = controller();
    const secret = "Garanti à 100 % : contactez amina@example.dz";
    for (let attempt = 1; attempt <= 2; attempt++) {
      await qc.reviewAndRecord({ taskId: "task-h", runId: "run-h", agent: "ContentCreatorAgent", outputKind: "content", output: { drafts: [{ kind: "post", language: "fr", text: secret }] }, schema: outputSchemas.content, language: "fr", allowlist: ALLOW, attempt });
    }
    const rows = await store.reviewsForTask("task-h");
    expect(rows.map((r) => r.attempt)).toEqual([1, 2]);
    expect(JSON.stringify(rows)).not.toContain("amina@example.dz");
    expect(JSON.stringify(rows)).not.toContain("Garanti");
  });

  it("a second record for the same attempt is refused", async () => {
    const { qc, store } = controller();
    const input = { taskId: "task-d", runId: "run-d", agent: "X", outputKind: "content" as const, output: { drafts: [{ kind: "post", language: "fr", text: "Découvrez notre accompagnement complet." }] }, schema: outputSchemas.content, language: "fr" as const, allowlist: ALLOW, attempt: 1 };
    await qc.reviewAndRecord(input);
    await expect(qc.reviewAndRecord(input)).rejects.toThrow("already exists");
    expect(await store.reviewsForTask("task-d")).toHaveLength(1);
  });
});

describe("access", () => {
  it("an agent cannot read quality reviews; the owner and the platform can", async () => {
    const { qc } = controller();
    await expect(qc.history({ kind: "agent", agent: "SalesAgent" }, "task-x")).rejects.toBeInstanceOf(QualityForbiddenError);
    await expect(qc.history({ kind: "owner", id: "owner-1" }, "task-x")).resolves.toEqual([]);
    await expect(qc.history({ kind: "system" }, "task-x")).resolves.toEqual([]);
  });

  it("every decision is written to the audit trail", async () => {
    const { qc, audit } = controller();
    await qc.reviewAndRecord({ taskId: "task-a", runId: "run-a", agent: "X", outputKind: "visa", output: visa([req()]), schema: outputSchemas.visa, language: "fr", allowlist: ALLOW, attempt: 1 });
    expect(audit.events.map((e) => e.type)).toEqual(["quality.reviewed"]);
    expect(audit.events[0].meta.status).toBe("PASSED");
  });
});

describe("the quality gate inside a workflow", () => {
  it("an output that keeps making unsupported confident claims is revised twice, then rejected and escalated", async () => {
    const { makeHarness, startInput, ScriptedProvider, agentNameIn } = await import("./helpers");
    const { MockProvider } = await import("@/lib/ai/llm/mock-provider");
    const mock = new MockProvider("scripted");
    const provider = new ScriptedProvider("scripted", (req) => {
      if (agentNameIn(req.system) === "Market Research Agent") {
        return JSON.stringify({ findings: [{ insight: "Demand doubles every month.", evidence: "Trust us.", confidence: "high", sources: [] }] });
      }
      return mock.complete(req).then((r) => r.text);
    });
    const cfg = { id: "scripted", kind: "mock" as const, costTier: "free" as const, enabled: true, ownerApproved: true, dailyRequestLimit: 1000 };
    const h = makeHarness({ providers: [{ config: cfg, provider }] });
    const { runId } = await h.orch.startWorkflow(startInput({ idempotencyKey: "quality-loop-01" }));
    for (let i = 0; i < 40; i++) {
      const report = await h.orch.tick({ limit: 10 });
      if (report.claimed === 0) break;
    }
    const research = (await h.store.listTasksByRunIds([runId])).find((t) => t.stepKey === "research")!;
    expect(research.status).toBe("failed");
    expect(research.lastError).toContain("Quality rejected");
    const reviews = await h.quality.history({ kind: "system" }, research.id);
    expect(reviews.map((r) => r.status)).toEqual(["NEEDS_REVISION", "NEEDS_REVISION", "REJECTED"]);
    expect(h.audit.events.filter((e) => e.type === "task.revision_requested")).toHaveLength(2);
    // The tick already dispatched the failure event, so the COO's escalation is on the trail.
    expect(h.audit.events.some((e) => e.type === "coo.escalated" && e.entityId === research.id)).toBe(true);
  });
});
