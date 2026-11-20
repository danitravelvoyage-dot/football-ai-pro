import { type ActionClass, isExternalAction } from "./types";

/**
 * Version 1 policy: the platform never executes an external action itself.
 * An approved external action becomes an "owner action card" that the owner carries out by hand.
 */
export const EXECUTE_EXTERNAL_ACTIONS = false as const;

export class ExternalActionBlockedError extends Error {
  constructor(public readonly action: ActionClass) {
    super(`External action "${action}" is blocked: the owner must perform it manually.`);
    this.name = "ExternalActionBlockedError";
  }
}

/** Throws unless the action is internal. Call before any side effect that leaves the platform. */
export function assertCanExecute(action: ActionClass): void {
  if (isExternalAction(action) && !EXECUTE_EXTERNAL_ACTIONS) {
    throw new ExternalActionBlockedError(action);
  }
}

/** Every external action must go through owner approval. Internal actions do not. */
export function requiresOwnerApproval(action: ActionClass): boolean {
  return isExternalAction(action) || action === "propose_change";
}
