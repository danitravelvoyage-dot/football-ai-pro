import { describe, expect, it } from "vitest";
import {
  CORE_MODULES,
  classifyLoadError,
  departmentCoverage,
  groupTasksByRun,
  progressOf,
  riskTone,
  rollupByAgent,
  rollupByDepartment,
  sortTasks,
  statusTone,
  truncate,
} from "@/lib/ai/command-center/view";
import { AGENT_KEYS, type AgentKey, type TaskStatus } from "@/lib/ai/types";
import type { TaskRecord } from "@/lib/ai/orchestration/records";

let counter = 0;
function task(agent: AgentKey, status: TaskStatus, runId = "run-1", createdAt = "2026-11-20T09:00:00.000Z"): TaskRecord {
  counter += 1;
  return {
    id: `task-${counter}`,
    runId,
    workflowKey: "marketing",
    stepKey: `step-${counter}`,
    agent,
    title: `Task ${counter}`,
    status,
    priority: 1,
    dueAt: null,
    dependsOn: [],
    input: {} as TaskRecord["input"],
    output: null,
    actionClass: null,
    requiresApproval: false,
    attempts: 0,
    maxAttempts: 3,
    nextRunAt: createdAt,
    lastError: null,
    createdAt,
    updatedAt: createdAt,
  };
}

describe("department map", () => {
  it("places every agent in exactly one department", () => {
    expect(departmentCoverage()).toEqual([]);
  });

  it("covers the sixteen agents", () => {
    expect(AGENT_KEYS).toHaveLength(16);
  });

  it("department totals add up to the task total", () => {
    const tasks = [task("SEOAgent", "succeeded"), task("VisaResearchAgent", "failed"), task("FinanceAgent", "running")];
    const rolled = rollupByDepartment(tasks);
    const total = rolled.reduce((sum, d) => sum + d.rollup.total, 0);
    expect(total).toBe(3);
    const creative = rolled.find((d) => d.key === "creative");
    expect(creative?.rollup.succeeded).toBe(1);
    const intelligence = rolled.find((d) => d.key === "intelligence");
    expect(intelligence?.rollup.failed).toBe(1);
  });
});

describe("agent rollups", () => {
  it("counts succeeded, failed and active tasks per agent", () => {
    const tasks = [
      task("SalesAgent", "succeeded"),
      task("SalesAgent", "failed"),
      task("SalesAgent", "waiting_approval"),
      task("SalesAgent", "pending"),
      task("CRMAgent", "ready"),
    ];
    const r = rollupByAgent(tasks);
    expect(r.SalesAgent).toEqual({ total: 4, succeeded: 1, failed: 1, active: 2 });
    expect(r.CRMAgent).toEqual({ total: 1, succeeded: 0, failed: 0, active: 1 });
    expect(r.SEOAgent).toEqual({ total: 0, succeeded: 0, failed: 0, active: 0 });
  });

  it("ignores a task whose agent is not in the registry instead of crashing", () => {
    const bad = { ...task("SEOAgent", "failed"), agent: "UnknownAgent" as AgentKey };
    expect(() => rollupByAgent([bad])).not.toThrow();
  });
});

describe("load error classification", () => {
  it("treats a missing table as not installed", () => {
    expect(classifyLoadError('relation "public.ai_tasks" does not exist')).toBe("not_installed");
    expect(classifyLoadError("Could not find the table 'public.ai_tasks' in the schema cache")).toBe("not_installed");
  });

  it("treats every other failure as a generic error", () => {
    expect(classifyLoadError("new row violates row-level security policy")).toBe("error");
    expect(classifyLoadError("JWT expired")).toBe("error");
    expect(classifyLoadError("")).toBe("error");
  });
});

describe("ordering and grouping", () => {
  it("lists failures first, then work in progress, then finished work", () => {
    const tasks = [
      task("SEOAgent", "succeeded", "r", "2026-11-20T09:00:01.000Z"),
      task("SEOAgent", "failed", "r", "2026-11-20T09:00:03.000Z"),
      task("SEOAgent", "running", "r", "2026-11-20T09:00:02.000Z"),
      task("SEOAgent", "blocked", "r", "2026-11-20T09:00:04.000Z"),
    ];
    expect(sortTasks(tasks).map((t) => t.status)).toEqual(["failed", "blocked", "running", "succeeded"]);
  });

  it("groups tasks by workflow run and reports progress", () => {
    const tasks = [task("SEOAgent", "succeeded", "a"), task("SEOAgent", "pending", "a"), task("SEOAgent", "succeeded", "b")];
    const grouped = groupTasksByRun(tasks);
    expect(grouped.get("a")).toHaveLength(2);
    expect(progressOf(grouped.get("a") ?? [])).toEqual({ done: 1, total: 2 });
    expect(progressOf(grouped.get("b") ?? [])).toEqual({ done: 1, total: 1 });
  });
});

describe("display helpers", () => {
  it("maps statuses and risk levels to tones", () => {
    expect(statusTone("succeeded")).toBe("success");
    expect(statusTone("failed")).toBe("danger");
    expect(statusTone("waiting_approval")).toBe("gold");
    expect(riskTone("high")).toBe("danger");
    expect(riskTone("low")).toBe("success");
  });

  it("truncates long text with an ellipsis and leaves short text alone", () => {
    expect(truncate("short", 10)).toBe("short");
    const long = truncate("x".repeat(50), 10);
    expect(long).toHaveLength(10);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("core module statement", () => {
  it("never lists a module as both built and not built", () => {
    const overlap = CORE_MODULES.built.filter((m) => (CORE_MODULES.notBuilt as readonly string[]).includes(m));
    expect(overlap).toEqual([]);
  });

  it("reports the three modules that are not built yet", () => {
    expect([...CORE_MODULES.notBuilt].sort()).toEqual(["EVENT_BUS", "KNOWLEDGE_BASE", "SHARED_CONTEXT"]);
  });
});
