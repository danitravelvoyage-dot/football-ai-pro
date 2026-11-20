import type { TaskStatus } from "../types";

export interface GraphNode {
  id: string;
  status: TaskStatus;
  dependsOn: readonly string[];
}

export class CyclicDependencyError extends Error {
  constructor(public readonly cycle: string[]) {
    super(`Task dependencies contain a cycle: ${cycle.join(" -> ")}`);
    this.name = "CyclicDependencyError";
  }
}

/** Throws if the dependency graph has a missing node or a cycle. Run before saving a workflow run. */
export function assertValidGraph(nodes: readonly GraphNode[]): void {
  const ids = new Set(nodes.map((n) => n.id));
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (!ids.has(dep)) throw new Error(`Task ${node.id} depends on unknown task ${dep}.`);
    }
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];

  const visit = (id: string): void => {
    const mark = state.get(id);
    if (mark === "done") return;
    if (mark === "visiting") {
      const start = stack.indexOf(id);
      throw new CyclicDependencyError([...stack.slice(start), id]);
    }
    state.set(id, "visiting");
    stack.push(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) visit(dep);
    stack.pop();
    state.set(id, "done");
  };
  for (const node of nodes) visit(node.id);
}

export interface ReadinessChanges {
  toReady: string[];
  toBlocked: string[];
  toPending: string[];
}

/**
 * Decides which tasks should move. Pure function: no I/O.
 * - pending -> ready when every dependency succeeded
 * - pending/ready -> blocked when any dependency failed, was cancelled or is blocked
 * - blocked -> pending when the blocking dependency is resolved again
 */
export function computeReadiness(nodes: readonly GraphNode[]): ReadinessChanges {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const changes: ReadinessChanges = { toReady: [], toBlocked: [], toPending: [] };

  for (const node of nodes) {
    const deps = node.dependsOn.map((id) => byId.get(id)?.status ?? "blocked");
    const anyBad = deps.some((s) => s === "failed" || s === "cancelled" || s === "blocked");
    const allDone = deps.every((s) => s === "succeeded");

    if (node.status === "pending" || node.status === "ready") {
      if (anyBad) changes.toBlocked.push(node.id);
      else if (allDone && node.status === "pending") changes.toReady.push(node.id);
    } else if (node.status === "blocked") {
      if (!anyBad) changes.toPending.push(node.id);
    }
  }
  return changes;
}

/** Ids of every task that depends, directly or indirectly, on the given task. */
export function downstreamOf(nodes: readonly GraphNode[], id: string): string[] {
  const result = new Set<string>();
  let frontier = [id];
  while (frontier.length) {
    const next: string[] = [];
    for (const node of nodes) {
      if (node.dependsOn.some((d) => frontier.includes(d)) && !result.has(node.id)) {
        result.add(node.id);
        next.push(node.id);
      }
    }
    frontier = next;
  }
  return [...result];
}
