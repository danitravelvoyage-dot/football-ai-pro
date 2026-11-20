import { describe, it, expect } from "vitest";
import { checkCompliance } from "@/lib/ai/workflows/compliance-rules";
import { summarizeAggregates, validateVisaRequirements } from "@/lib/ai/workflows/deterministic";
import { assertTransition, canTransition, InvalidTransitionError } from "@/lib/ai/orchestration/state";
import { assertValidGraph, CyclicDependencyError, computeReadiness, downstreamOf } from "@/lib/ai/orchestration/graph";
import { backoffDelayMs, shouldRetry } from "@/lib/ai/orchestration/retry";

describe("compliance rules", () => {
  it("blocks guaranteed visa outcomes in French, English and Arabic", () => {
    expect(checkCompliance("Nous garantissons votre visa.").verdict).toBe("fail");
    expect(checkCompliance("We guarantee approval.").verdict).toBe("fail");
    expect(checkCompliance("نضمن لك الحصول على التأشيرة").verdict).toBe("fail");
  });

  it("blocks availability claims that are not verified against the official calendar", () => {
    const result = checkCompliance("Rendez-vous France disponibles dans 10 jours.");
    expect(result.verdict).toBe("fail");
    expect(result.flags.map((f) => f.rule)).toContain("unverified-availability");
    expect(checkCompliance("مواعيد فرنسا متوفرة بعد 10 أيام").verdict).toBe("fail");
  });

  it("blocks fake urgency", () => {
    expect(checkCompliance("Dernière chance, plus que 2 places !").verdict).toBe("fail");
  });

  it("passes neutral, honest copy", () => {
    const result = checkCompliance("Nous vous aidons à préparer votre dossier. Écrivez-nous sur WhatsApp.");
    expect(result.verdict).toBe("pass");
    expect(result.flags).toHaveLength(0);
  });

  it("warns (does not block) on testimonial references", () => {
    const result = checkCompliance("Témoignage de notre client");
    expect(result.verdict).toBe("pass");
    expect(result.flags[0]?.severity).toBe("warning");
  });
});

describe("deterministic analytics aggregation", () => {
  it("sums counts by status and computes conversion to approved", () => {
    const summary = summarizeAggregates([
      { status: "new", count: 6 },
      { status: "approved", count: 3 },
      { status: "completed", count: 1 },
    ]);
    expect(summary.total).toBe(10);
    expect(summary.byStatus.new).toBe(6);
    expect(summary.conversionToApproved).toBe(40);
  });

  it("returns null conversion when there is no data", () => {
    expect(summarizeAggregates([]).conversionToApproved).toBeNull();
  });
});

describe("visa source and date validation", () => {
  const today = new Date("2026-11-20T00:00:00Z");
  const good = {
    destination: "France",
    item: "Passport validity",
    source_url: "https://www.diplomatie.gouv.fr/fr/services-aux-etrangers",
    last_checked: "2026-11-10",
    verified_by_official_source: true,
  };

  it("accepts a requirement from an allowlisted official source, verified and recently checked", () => {
    expect(validateVisaRequirements([good], ["www.diplomatie.gouv.fr"], today).ok).toBe(true);
  });

  it("rejects sources that are not on the owner's allowlist", () => {
    const result = validateVisaRequirements([{ ...good, source_url: "https://blog.example.com/visa" }], ["www.diplomatie.gouv.fr"], today);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.problem).toBe("source_not_allowlisted");
  });

  it("with an empty allowlist nothing passes", () => {
    expect(validateVisaRequirements([good], [], today).ok).toBe(false);
  });

  it("rejects stale checks and unverified items", () => {
    const stale = validateVisaRequirements([{ ...good, last_checked: "2026-08-01" }], ["www.diplomatie.gouv.fr"], today);
    expect(stale.issues.map((i) => i.problem)).toContain("stale_check");
    const unverified = validateVisaRequirements([{ ...good, verified_by_official_source: false }], ["www.diplomatie.gouv.fr"], today);
    expect(unverified.issues.map((i) => i.problem)).toContain("source_not_verified");
  });
});

describe("task state machine", () => {
  it("allows the normal lifecycle", () => {
    assertTransition("pending", "ready");
    assertTransition("ready", "running");
    assertTransition("running", "succeeded");
  });

  it("allows approval and retry paths", () => {
    assertTransition("running", "waiting_approval");
    assertTransition("waiting_approval", "cancelled");
    assertTransition("running", "ready");
    assertTransition("failed", "ready");
  });

  it("rejects skipping states and leaving terminal states", () => {
    expect(canTransition("pending", "succeeded")).toBe(false);
    expect(() => assertTransition("succeeded", "running")).toThrow(InvalidTransitionError);
    expect(() => assertTransition("cancelled", "ready")).toThrow(InvalidTransitionError);
  });
});

describe("dependency graph", () => {
  it("detects cycles and missing dependencies", () => {
    expect(() =>
      assertValidGraph([
        { id: "a", status: "pending", dependsOn: ["b"] },
        { id: "b", status: "pending", dependsOn: ["a"] },
      ]),
    ).toThrow(CyclicDependencyError);
    expect(() => assertValidGraph([{ id: "a", status: "pending", dependsOn: ["ghost"] }])).toThrow(/unknown task/);
  });

  it("marks a task ready only when every dependency succeeded", () => {
    const nodes = [
      { id: "a", status: "succeeded" as const, dependsOn: [] },
      { id: "b", status: "pending" as const, dependsOn: ["a"] },
      { id: "c", status: "pending" as const, dependsOn: ["a", "b"] },
    ];
    expect(computeReadiness(nodes).toReady).toEqual(["b"]);
  });

  it("blocks dependents of a failed or cancelled task, and unblocks them when it is fixed", () => {
    const failed = [
      { id: "a", status: "failed" as const, dependsOn: [] },
      { id: "b", status: "pending" as const, dependsOn: ["a"] },
    ];
    expect(computeReadiness(failed).toBlocked).toEqual(["b"]);
    const fixed = [
      { id: "a", status: "succeeded" as const, dependsOn: [] },
      { id: "b", status: "blocked" as const, dependsOn: ["a"] },
    ];
    expect(computeReadiness(fixed).toPending).toEqual(["b"]);
  });

  it("finds all downstream tasks", () => {
    const nodes = [
      { id: "a", status: "pending" as const, dependsOn: [] },
      { id: "b", status: "pending" as const, dependsOn: ["a"] },
      { id: "c", status: "pending" as const, dependsOn: ["b"] },
      { id: "d", status: "pending" as const, dependsOn: [] },
    ];
    expect(downstreamOf(nodes, "a").sort()).toEqual(["b", "c"]);
  });
});

describe("retry policy", () => {
  it("uses exponential backoff with a cap", () => {
    expect(backoffDelayMs(1)).toBe(2_000);
    expect(backoffDelayMs(2)).toBe(4_000);
    expect(backoffDelayMs(3)).toBe(8_000);
    expect(backoffDelayMs(30)).toBe(300_000);
  });

  it("retries only retryable failures and only until the attempt limit", () => {
    expect(shouldRetry(1, true)).toBe(true);
    expect(shouldRetry(3, true)).toBe(false);
    expect(shouldRetry(1, false)).toBe(false);
  });
});
