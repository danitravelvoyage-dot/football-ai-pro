import { describe, it, expect } from "vitest";
import { assertCanExecute, ExternalActionBlockedError, requiresOwnerApproval } from "@/lib/ai/policy";
import { ACTION_CLASSES, isExternalAction, type ActionClass } from "@/lib/ai/types";

describe("external action policy", () => {
  const external = ACTION_CLASSES.filter((a) => isExternalAction(a));
  const internal = ACTION_CLASSES.filter((a) => !isExternalAction(a));

  it("every external action is blocked from execution", () => {
    expect(external.length).toBeGreaterThanOrEqual(5);
    for (const action of external) {
      expect(() => assertCanExecute(action)).toThrow(ExternalActionBlockedError);
    }
  });

  it("internal actions remain executable", () => {
    for (const action of internal) expect(() => assertCanExecute(action)).not.toThrow();
  });

  it("every external action requires owner approval", () => {
    for (const action of external) expect(requiresOwnerApproval(action)).toBe(true);
  });

  it("proposing a change requires owner approval; plain reads and drafts do not", () => {
    expect(requiresOwnerApproval("propose_change")).toBe(true);
    expect(requiresOwnerApproval("read_internal" as ActionClass)).toBe(false);
    expect(requiresOwnerApproval("write_draft" as ActionClass)).toBe(false);
  });
});
