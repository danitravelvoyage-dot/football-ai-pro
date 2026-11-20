import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryService, MemoryForbiddenError, MemoryValidationError } from "@/lib/ai/memory/service";
import { MemoryMemoryStore } from "@/lib/ai/memory/store";
import { MemoryAuditSink } from "@/lib/ai/audit";
import { compareVariants, requireEvidence, EvidenceError } from "@/lib/ai/memory/learning";
import { DEFAULT_LEARNING_SETTINGS, MIN_EVIDENCE_SAMPLE } from "@/lib/ai/memory/types";
import { parseSubject, parseVersion, percentOf } from "@/lib/ai/command-center/memory-view";
import { makeClock, makeIds, OWNER } from "./helpers";
import type { ResultRecord } from "@/lib/ai/memory/store";

const AGENT = { kind: "agent" as const, agent: "SalesAgent" as const };
const SYSTEM = { kind: "system" as const };

function service() {
  const clock = makeClock("2026-11-20T09:00:00.000Z");
  const store = new MemoryMemoryStore();
  const audit = new MemoryAuditSink();
  return { svc: new MemoryService({ store, audit, now: clock.now, newId: makeIds("m") }), store, audit };
}

function r(variant: string, value: number, sampleSize: number): ResultRecord {
  return { id: `${variant}-${value}`, experimentId: "e", variant, metric: "conversions", value, sampleSize, source: "manual", period: "2026-11", recordedBy: "owner:o", recordedAt: "2026-11-20T09:00:00.000Z" };
}

describe("owner-set learning thresholds", () => {
  it("the defaults apply until the owner sets them", async () => {
    const { svc } = service();
    expect(await svc.learningSettings(OWNER)).toEqual(DEFAULT_LEARNING_SETTINGS);
  });

  it("only the owner can change them, and the change is audited", async () => {
    const { svc, audit } = service();
    await expect(svc.setLearningSettings(AGENT, { minSample: 50, minLift: 0.3 })).rejects.toBeInstanceOf(MemoryForbiddenError);
    await expect(svc.setLearningSettings(SYSTEM, { minSample: 50, minLift: 0.3 })).rejects.toBeInstanceOf(MemoryForbiddenError);
    const saved = await svc.setLearningSettings(OWNER, { minSample: 50, minLift: 0.3 });
    expect(saved).toEqual({ minSample: 50, minLift: 0.3 });
    expect(audit.events.map((e) => e.type)).toEqual(["learning.settings"]);
    expect(await svc.learningSettings(OWNER)).toEqual({ minSample: 50, minLift: 0.3 });
  });

  it("values outside the allowed bounds are refused before anything is stored", async () => {
    const { svc } = service();
    await expect(svc.setLearningSettings(OWNER, { minSample: 1, minLift: 0.2 })).rejects.toBeInstanceOf(MemoryValidationError);
    await expect(svc.setLearningSettings(OWNER, { minSample: 30, minLift: 0 })).rejects.toBeInstanceOf(MemoryValidationError);
    await expect(svc.setLearningSettings(OWNER, { minSample: 30.5, minLift: 0.2 })).rejects.toBeInstanceOf(MemoryValidationError);
    expect(await svc.learningSettings(OWNER)).toEqual(DEFAULT_LEARNING_SETTINGS);
  });

  it("the thresholds change the verdict: a lift that is inconclusive at 20 percent can win at 5 percent", () => {
    const rs = [r("a", 11, 100), r("b", 10, 100)];
    expect(compareVariants(rs, "conversions").verdict).toBe("inconclusive");
    expect(compareVariants(rs, "conversions", { minSample: 30, minLift: 0.05 }).verdict).toBe("winner");
  });

  it("the sample threshold changes what counts as evidence", () => {
    const rs = [r("a", 20, 40), r("b", 5, 40)];
    expect(compareVariants(rs, "conversions", { minSample: 30, minLift: 0.2 }).verdict).toBe("winner");
    expect(compareVariants(rs, "conversions", { minSample: 60, minLift: 0.2 }).verdict).toBe("insufficient_data");
    expect(() => requireEvidence({ kind: "hypothesis", statement: "x", evidence: [{ experimentId: "e", metric: "conversions", variant: "a", sampleSize: 40 }] }, { minSample: 60, minLift: 0.2 })).toThrow(EvidenceError);
    expect(MIN_EVIDENCE_SAMPLE).toBe(30);
  });
});

describe("strategy changes need the owner's explicit decision", () => {
  it("a strategy decision is only ever recorded by the owner, never by the platform", async () => {
    const { svc, store } = service();
    await expect(svc.recordDecision(SYSTEM, { subjectType: "strategy", subjectRef: "s", decision: "approved", reasoning: "auto" })).rejects.toBeInstanceOf(MemoryForbiddenError);
    expect(await store.latestDecision("strategy", "s")).toBeNull();
  });
});

describe("page helpers", () => {
  it("parses a subject only in the expected shape", () => {
    expect(parseSubject("strategy:spring-2026")).toEqual({ type: "strategy", ref: "spring-2026" });
    expect(parseSubject("strategy:")).toBeNull();
    expect(parseSubject("Strategy:x")).toBeNull();
    expect(parseSubject("nocolon")).toBeNull();
    expect(parseSubject(":x")).toBeNull();
    expect(parseSubject("strategy:" + "x".repeat(200))).toBeNull();
  });

  it("parses a version only as a positive whole number", () => {
    expect(parseVersion("3")).toBe(3);
    expect(parseVersion("0")).toBeNull();
    expect(parseVersion("-1")).toBeNull();
    expect(parseVersion("1.5")).toBeNull();
    expect(parseVersion("abc")).toBeNull();
    expect(parseVersion(undefined)).toBeNull();
  });

  it("percentages round to whole numbers", () => {
    expect(percentOf(0.2)).toBe(20);
    expect(percentOf(0.256)).toBe(26);
  });
});

const ROOT = resolve(__dirname, "../..");
const NEW_PAGES = ["memory", "experiments", "profile"].map((p) => resolve(ROOT, `app/[locale]/admin/command-center/${p}/page.tsx`));

describe("layout rules for right-to-left and mobile", () => {
  it("the new pages use logical direction classes only, so Arabic lays out right to left", () => {
    for (const file of NEW_PAGES) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/\b(ml|mr|pl|pr)-\d/);
      expect(src, file).not.toMatch(/\btext-(left|right)\b/);
      expect(src, file).not.toMatch(/\b(left|right)-\d/);
    }
  });

  it("every multi-column grid starts at one column on a phone, and widens only at a breakpoint", () => {
    for (const file of [...NEW_PAGES, resolve(ROOT, "app/[locale]/admin/command-center/loading.tsx")]) {
      const src = readFileSync(file, "utf8");
      for (const match of src.matchAll(/className="([^"]*)"/g)) {
        const classes = match[1].split(/\s+/);
        for (const c of classes) {
          const bare = c.replace(/^(sm|md|lg|xl|2xl):/, "");
          if (/^grid-cols-([2-9]|1[0-2])$/.test(bare)) {
            expect(c.includes(":"), `${file}: ${c}`).toBe(true);
          }
        }
      }
    }
  });

  it("codes, references and values are shown left to right inside Arabic pages", () => {
    for (const file of NEW_PAGES) {
      const src = readFileSync(file, "utf8");
      if (src.includes("font-mono")) expect(src, file).toMatch(/font-mono[^"]*"[^>]*dir="ltr"|dir="ltr"[^>]*font-mono/);
    }
  });
});
