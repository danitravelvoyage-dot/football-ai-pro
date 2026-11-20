import type { TaskStatus } from "../types";

/** Allowed task transitions. Anything not listed is rejected. */
export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  pending: ["ready", "blocked", "cancelled"],
  ready: ["running", "blocked", "cancelled"],
  running: ["succeeded", "failed", "waiting_approval", "ready"],
  waiting_approval: ["succeeded", "cancelled"],
  succeeded: [],
  failed: ["ready", "cancelled"],
  blocked: ["pending", "cancelled"],
  cancelled: [],
};

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: TaskStatus,
    public readonly to: TaskStatus,
  ) {
    super(`Invalid task transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export function isTerminal(status: TaskStatus): boolean {
  return status === "succeeded" || status === "cancelled";
}
