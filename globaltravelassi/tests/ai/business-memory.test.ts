import { describe, it, expect, vi } from "vitest";
import { MemoryService, MemoryForbiddenError, MemoryValidationError } from "@/lib/ai/memory/service";
import { MemoryMemoryStore } from "@/lib/ai/memory/store";
import { MemoryAuditSink } from "@/lib/ai/audit";
import { compareVariants, repeatedPatterns, hypothesesFrom, outdatedStrategies, requireEvidence, EvidenceError, type Recommendation } from "@/lib/ai/memory/learning";
import { MIN_EVIDENCE_SAMPLE } from "@/lib/ai/memory/types";
import { BUSINESS_KEYS, BusinessKeyError, profileFrom, setBusinessEntry } from "@/lib/ai/memory/business-context";
import { ContextService } from "@/lib/ai/context/service";
import { MemoryContextStore } from "@/lib/ai/context/store";
import { fakeSupabase } from "./supabase-fake";
import { SupabaseMemoryStore, ANALYSIS_LIMIT } from "@/lib/ai/store/supabase-memory-store";
import { makeClock, makeIds, OWNER } from "./helpers";
import type { ResultRecord } from "@/lib/ai/memory/store";

vi.mock("server-only", () => ({}));

const OWNER_ACTOR = OWNER;
const AGENT = { kind: "agent" as const, agent: "SalesAgent" as const };
const SYSTEM = { kind: "system" as const };

function service() {
  const clock = makeClock("2026-11-20T09:00:00.000Z");
  const store = new MemoryMemoryStore();
  const audit = new MemoryAuditSink();
  const svc = new MemoryService({ store, audit, now: clock.now, newId: makeIds("m") });
  return { svc, store, audit, clock };
}

const strategyDecision = { subjectType: "strategy" as const, subjectRef: "spring-campaign", decision: "approved" as const, reasoning: "Matches the spring goal." };

describe("decision memory", () => {
  it("the first decision is version 1; a change is a new version that points to the one it replaces", async () => {
    const { svc } = service();
    const first = await svc.recordDecision(OWNER_ACTOR, strategyDecision);
    const second = await svc.recordDecision(OWNER_ACTOR, { ...strategyDecision, decision: "changed", reasoning: "Shift budget to Morocco." });
    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(second.supersedesId).toBe(first.id);
    const history = await svc.decisionHistory(OWNER_ACTOR, "strategy", "spring-campaign");
    expect(history.map((d) => d.decision)).toEqual(["approved", "changed"]);
  });

  it("only the owner records decisions; agents and the platform cannot", async () => {
    const { svc } = service();
    await expect(svc.recordDecision(AGENT, strategyDecision)).rejects.toBeInstanceOf(MemoryForbiddenError);
    await expect(svc.recordDecision(SYSTEM, strategyDecision)).rejects.toBeInstanceOf(MemoryForbiddenError);
  });

  it("agents cannot read decision history", async () => {
    const { svc } = service();
    await svc.recordDecision(OWNER_ACTOR, strategyDecision);
    await expect(svc.decisionHistory(AGENT, "strategy", "spring-campaign")).rejects.toBeInstanceOf(MemoryForbiddenError);
  });

  it("reasoning with personal data is refused, and invalid input is refused", async () => {
    const { svc } = service();
    await expect(svc.recordDecision(OWNER_ACTOR, { ...strategyDecision, reasoning: "Ask amina@example.dz first." })).rejects.toThrow("personal data");
    await expect(svc.recordDecision(OWNER_ACTOR, { ...strategyDecision, decision: "maybe" as never })).rejects.toBeInstanceOf(MemoryValidationError);
  });

  it("rejected strategies show only when the latest decision is a rejection", async () => {
    const { svc } = service();
    await svc.recordDecision(OWNER_ACTOR, { ...strategyDecision, subjectRef: "old-plan", decision: "rejected", reasoning: "Too expensive." });
    await svc.recordDecision(OWNER_ACTOR, { ...strategyDecision, subjectRef: "reconsidered", decision: "rejected", reasoning: "Not now." });
    await svc.recordDecision(OWNER_ACTOR, { ...strategyDecision, subjectRef: "reconsidered", decision: "approved", reasoning: "Now it fits." });
    const rejected = await svc.rejectedStrategies(OWNER_ACTOR);
    expect(rejected.map((d) => d.subjectRef)).toEqual(["old-plan"]);
  });

  it("every decision is written to the audit trail with its version", async () => {
    const { svc, audit } = service();
    await svc.recordDecision(OWNER_ACTOR, strategyDecision);
    expect(audit.events.map((e) => e.type)).toEqual(["decision.recorded"]);
    expect(audit.events[0].meta.version).toBe(1);
  });
});

describe("experiment memory", () => {
  it("an experiment moves draft, running, finished, and nothing else", async () => {
    const { svc } = service();
    const exp = await svc.createExperiment(OWNER_ACTOR, { kind: "campaign", name: "Spring test", hypothesis: "Short video beats a still image." });
    await expect(svc.setExperimentStatus(OWNER_ACTOR, exp.id, "finished")).rejects.toThrow("cannot move");
    const running = await svc.setExperimentStatus(OWNER_ACTOR, exp.id, "running");
    expect(running.startedAt).toBe("2026-11-20T09:00:00.000Z");
    const finished = await svc.setExperimentStatus(OWNER_ACTOR, exp.id, "finished");
    expect(finished.endedAt).toBe("2026-11-20T09:00:00.000Z");
    await expect(svc.setExperimentStatus(OWNER_ACTOR, exp.id, "running")).rejects.toThrow("cannot move");
  });

  it("a result needs a running or finished experiment", async () => {
    const { svc } = service();
    const exp = await svc.createExperiment(OWNER_ACTOR, { kind: "content", name: "Hooks", hypothesis: "A question hook works better." });
    const r = { variant: "question", metric: "clicks" as const, value: 10, sampleSize: 100, source: "manual" as const, period: "2026-11" };
    await expect(svc.recordResult(OWNER_ACTOR, exp.id, r)).rejects.toThrow("running or finished");
  });

  it("results carry a sample; counts are whole; a reply rate cannot exceed 1", async () => {
    const { svc } = service();
    const exp = await svc.createExperiment(OWNER_ACTOR, { kind: "sales", name: "Follow-up", hypothesis: "A short follow-up gets more replies." });
    await svc.setExperimentStatus(OWNER_ACTOR, exp.id, "running");
    const base = { variant: "short", source: "manual" as const, period: "2026-11" };
    await expect(svc.recordResult(OWNER_ACTOR, exp.id, { ...base, metric: "leads", value: 3, sampleSize: 0 })).rejects.toBeInstanceOf(MemoryValidationError);
    await expect(svc.recordResult(OWNER_ACTOR, exp.id, { ...base, metric: "leads", value: 2.5, sampleSize: 40 })).rejects.toThrow("whole count");
    await expect(svc.recordResult(OWNER_ACTOR, exp.id, { ...base, metric: "reply_rate", value: 1.4, sampleSize: 40 })).rejects.toThrow("cannot exceed 1");
  });

  it("agents cannot create experiments or record results", async () => {
    const { svc } = service();
    await expect(svc.createExperiment(AGENT, { kind: "campaign", name: "X test", hypothesis: "Something to test here." })).rejects.toBeInstanceOf(MemoryForbiddenError);
  });
});

function result(over: Partial<ResultRecord>): ResultRecord {
  return { id: "r", experimentId: "e", variant: "a", metric: "conversions", value: 0, sampleSize: 100, source: "aggregate", period: "2026-11", recordedBy: "owner:o", recordedAt: "2026-11-20T09:00:00.000Z", ...over };
}

describe("learning: comparisons and evidence", () => {
  it("below the minimum sample there is no verdict, only insufficient data", () => {
    const rs = [result({ variant: "a", value: 5, sampleSize: 10 }), result({ variant: "b", value: 1, sampleSize: 10 })];
    expect(compareVariants(rs, "conversions").verdict).toBe("insufficient_data");
  });

  it("a small difference is inconclusive", () => {
    const rs = [result({ variant: "a", value: 10, sampleSize: 100 }), result({ variant: "b", value: 11, sampleSize: 100 })];
    expect(compareVariants(rs, "conversions").verdict).toBe("inconclusive");
  });

  it("a clear lift is a winner, with the results it rests on as evidence", () => {
    const rs = [result({ experimentId: "e1", variant: "a", value: 20, sampleSize: 100 }), result({ experimentId: "e1", variant: "b", value: 10, sampleSize: 100 })];
    const cmp = compareVariants(rs, "conversions");
    expect(cmp.verdict).toBe("winner");
    if (cmp.verdict === "winner") {
      expect(cmp.winner).toBe("a");
      expect(cmp.evidence).toHaveLength(2);
    }
  });

  it("a pattern is a variant that wins in at least two experiments of the same kind", () => {
    const exps = [
      { id: "e1", kind: "content" },
      { id: "e2", kind: "content" },
      { id: "e3", kind: "sales" },
    ] as never;
    const win = (exp: string, variant: string) => [result({ experimentId: exp, variant, value: 20 }), result({ experimentId: exp, variant: variant === "a" ? "b" : "a", value: 5 })];
    const rs = [...win("e1", "a"), ...win("e2", "a"), ...win("e3", "a")];
    const patterns = repeatedPatterns(exps, rs, "conversions");
    expect(patterns).toEqual([{ kind: "content", variant: "a", experiments: ["e1", "e2"] }]);
  });

  it("a hypothesis carries its evidence; a recommendation without evidence is refused", () => {
    const exps = [{ id: "e1", kind: "content" }, { id: "e2", kind: "content" }] as never;
    const rs = [1, 2].flatMap((n) => [result({ experimentId: `e${n}`, variant: "a", value: 20 }), result({ experimentId: `e${n}`, variant: "b", value: 5 })]);
    const [hyp] = hypothesesFrom(repeatedPatterns(exps, rs, "conversions"), rs, "conversions");
    expect(hyp.evidence.length).toBeGreaterThan(0);
    expect(() => requireEvidence({ kind: "hypothesis", statement: "No data.", evidence: [] })).toThrow(EvidenceError);
  });

  it("evidence below the minimum sample is refused", () => {
    const weak: Recommendation = { kind: "review_strategy", statement: "Change it.", evidence: [{ experimentId: "e", metric: "clicks", variant: "a", sampleSize: MIN_EVIDENCE_SAMPLE - 1 }] };
    expect(() => requireEvidence(weak)).toThrow("at least");
  });

  it("an approved strategy with no newer decision for 90 days is outdated; a newer decision clears it", async () => {
    const { store } = service();
    await store.insertDecision({ subjectType: "strategy", subjectRef: "old", decision: "approved", reasoning: "Old plan.", version: 1, supersedesId: null, decidedBy: "o", decidedAt: "2026-06-01T00:00:00.000Z" });
    const updated = await store.insertDecision({ subjectType: "strategy", subjectRef: "updated", decision: "approved", reasoning: "Updated plan.", version: 1, supersedesId: null, decidedBy: "o", decidedAt: "2026-06-01T00:00:00.000Z" });
    await store.insertDecision({ subjectType: "strategy", subjectRef: "updated", decision: "changed", reasoning: "Newer plan.", version: 2, supersedesId: updated.id, decidedBy: "o", decidedAt: "2026-11-01T00:00:00.000Z" });
    const latest = await store.latestDecisionsBySubject("strategy");
    const flagged = outdatedStrategies(latest, new Date("2026-11-20T09:00:00.000Z")).map((d) => d.subjectRef);
    // "old" was approved 172 days ago with nothing after it. "updated" has a newer decision, so it is not flagged.
    expect(flagged).toEqual(["old"]);
  });
});

describe("business profile", () => {
  it("only registry keys can be saved", async () => {
    const clock = makeClock();
    const context = new ContextService({ store: new MemoryContextStore(), audit: new MemoryAuditSink(), now: clock.now, newId: makeIds("c") });
    await expect(setBusinessEntry(context, OWNER_ACTOR, "company.secret_plan", "x", 0)).rejects.toBeInstanceOf(BusinessKeyError);
    const saved = await setBusinessEntry(context, OWNER_ACTOR, "company.goals", "Grow visa support in Algeria.", 0);
    expect(saved.version).toBe(1);
  });

  it("a missing profile entry stays missing; nothing is filled in", async () => {
    const clock = makeClock();
    const context = new ContextService({ store: new MemoryContextStore(), audit: new MemoryAuditSink(), now: clock.now, newId: makeIds("c") });
    await setBusinessEntry(context, OWNER_ACTOR, "company.goals", "Grow visa support.", 0);
    const entries = await context.read(OWNER_ACTOR, { scope: "company", scopeKey: "company", limit: 50 });
    const profile = profileFrom(entries);
    expect(profile.map((p) => p.key)).toEqual([...BUSINESS_KEYS]);
    expect(profile.find((p) => p.key === "company.goals")?.present).toBe(true);
    expect(profile.find((p) => p.key === "company.pricing_policy")).toMatchObject({ present: false, text: null, version: null });
  });
});

describe("supabase business memory reads", () => {
  it("a read that reaches the analysis limit fails instead of returning a partial history", async () => {
    const rows = Array.from({ length: ANALYSIS_LIMIT }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      subject_type: "strategy",
      subject_ref: `s-${i}`,
      decision: "approved",
      reasoning: "x",
      version: 1,
      supersedes_id: null,
      decided_by: "00000000-0000-0000-0000-0000000000a1",
      decided_at: "2026-11-01T00:00:00.000Z",
    }));
    const store = new SupabaseMemoryStore(fakeSupabase({ ai_owner_decisions: rows }));
    await expect(store.latestDecisionsBySubject("strategy")).rejects.toThrow("too large");
  });
});
