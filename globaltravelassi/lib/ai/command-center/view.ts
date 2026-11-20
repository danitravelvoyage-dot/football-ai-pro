import { AGENT_KEYS, type AgentKey, type TaskStatus } from "../types";
import { DEPARTMENTS } from "../departments";
import type { TaskRecord } from "../orchestration/records";

/**
 * Pure helpers for the command-center pages. No database or server-only imports here,
 * so every rule can be unit-tested directly.
 */

export type LoadErrorKind = "not_installed" | "error";

const MISSING_RELATION = /does not exist|could not find the table|schema cache|42P01|PGRST205/i;

/** A missing table means the migration has not been applied. Anything else is a generic error. Raw messages are never shown. */
export function classifyLoadError(message: string): LoadErrorKind {
  return MISSING_RELATION.test(message) ? "not_installed" : "error";
}

export const ACTIVE_STATUSES: readonly TaskStatus[] = ["pending", "ready", "running", "waiting_approval"];

/** Failures and blocks first, then work in progress, then finished work. */
const STATUS_ORDER: Record<TaskStatus, number> = {
  failed: 0,
  blocked: 1,
  waiting_approval: 2,
  running: 3,
  ready: 4,
  pending: 5,
  succeeded: 6,
  cancelled: 7,
};

export interface Rollup {
  total: number;
  succeeded: number;
  failed: number;
  active: number;
}

function emptyRollup(): Rollup {
  return { total: 0, succeeded: 0, failed: 0, active: 0 };
}

function addTo(r: Rollup, status: TaskStatus): void {
  r.total += 1;
  if (status === "succeeded") r.succeeded += 1;
  if (status === "failed") r.failed += 1;
  if (ACTIVE_STATUSES.includes(status)) r.active += 1;
}

export function rollupByAgent(tasks: TaskRecord[]): Record<AgentKey, Rollup> {
  const out = Object.fromEntries(AGENT_KEYS.map((key) => [key, emptyRollup()])) as Record<AgentKey, Rollup>;
  for (const task of tasks) {
    const r = out[task.agent];
    if (r) addTo(r, task.status);
  }
  return out;
}

export function rollupByDepartment(tasks: TaskRecord[]) {
  const byAgent = rollupByAgent(tasks);
  return DEPARTMENTS.map((department) => {
    const total = emptyRollup();
    for (const agent of department.agents) {
      const r = byAgent[agent];
      total.total += r.total;
      total.succeeded += r.succeeded;
      total.failed += r.failed;
      total.active += r.active;
    }
    return { key: department.key, agents: department.agents, rollup: total };
  });
}

/** Every agent must belong to exactly one department. An empty list means the map is complete. */
export function departmentCoverage(): string[] {
  const problems: string[] = [];
  const seen = new Map<string, number>();
  for (const department of DEPARTMENTS) {
    for (const agent of department.agents) seen.set(agent, (seen.get(agent) ?? 0) + 1);
  }
  for (const key of AGENT_KEYS) {
    const count = seen.get(key) ?? 0;
    if (count !== 1) problems.push(`${key} appears in ${count} departments.`);
  }
  for (const key of seen.keys()) {
    if (!(AGENT_KEYS as readonly string[]).includes(key)) problems.push(`Unknown agent ${key}.`);
  }
  return problems;
}

export type BadgeTone = "neutral" | "info" | "warning" | "success" | "danger" | "gold";

export function statusTone(status: TaskStatus): BadgeTone {
  switch (status) {
    case "succeeded":
      return "success";
    case "failed":
      return "danger";
    case "blocked":
      return "warning";
    case "waiting_approval":
      return "gold";
    case "running":
    case "ready":
      return "info";
    default:
      return "neutral";
  }
}

export function riskTone(level: "low" | "medium" | "high"): BadgeTone {
  if (level === "high") return "danger";
  if (level === "medium") return "warning";
  return "success";
}

export function sortTasks(tasks: TaskRecord[]): TaskRecord[] {
  return [...tasks].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.createdAt.localeCompare(b.createdAt));
}

export function groupTasksByRun(tasks: TaskRecord[]): Map<string, TaskRecord[]> {
  const map = new Map<string, TaskRecord[]>();
  for (const task of tasks) {
    const list = map.get(task.runId);
    if (list) list.push(task);
    else map.set(task.runId, [task]);
  }
  return map;
}

export function progressOf(tasks: TaskRecord[]): { done: number; total: number } {
  return { done: tasks.filter((t) => t.status === "succeeded").length, total: tasks.length };
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Core modules and their build state. Static on purpose: this is a statement about the code, not a metric. */
export const CORE_MODULES = {
  built: ["AGENT_REGISTRY", "AGENT_EXECUTOR", "TASK_ORCHESTRATOR", "WORKFLOW_ENGINE", "APPROVAL_ENGINE", "AUDIT_LOG", "USAGE_MONITOR", "ERROR_RECOVERY", "QUOTA_ENFORCEMENT"],
  notBuilt: ["SHARED_CONTEXT", "KNOWLEDGE_BASE", "EVENT_BUS"],
} as const;
