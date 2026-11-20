import { isExternalAction, TASK_STATUSES, type ActionClass, type TaskStatus } from "./types";
import type { ApprovalRecord, TaskRecord } from "./orchestration/records";
import { getWorkflow, type WorkflowKey, type WorkflowStep } from "./workflows/templates";

/** External actions never show as completed. The owner performs them, so the report only reports their state. */
export type ExternalItemStatus = "awaiting_owner_approval" | "awaiting_owner_execution" | "rejected" | "expired";

export interface PlannedStep {
  stepKey: string;
  agent: string;
  priority: number;
  dueAt: string | null;
  requiresOwnerApproval: boolean;
  dependsOn: string[];
}

/** Turns a workflow template into an ordered plan. The COO adds priorities, deadlines and approval flags. */
export function planWorkflow(key: WorkflowKey, now: Date): PlannedStep[] {
  return getWorkflow(key).steps.map((s: WorkflowStep) => ({
    stepKey: s.key,
    agent: s.agent,
    priority: s.priority,
    dueAt: s.dueInHours ? new Date(now.getTime() + s.dueInHours * 3_600_000).toISOString() : null,
    requiresOwnerApproval: s.approval !== null,
    dependsOn: s.dependsOn,
  }));
}

export function externalStatusFor(approval: ApprovalRecord): ExternalItemStatus | null {
  if (!isExternalAction(approval.actionClass)) return null;
  if (approval.status === "pending") return "awaiting_owner_approval";
  if (approval.status === "approved") return "awaiting_owner_execution";
  if (approval.status === "expired") return "expired";
  return "rejected";
}

export interface ExecutiveReport {
  generatedAt: string;
  counts: Record<TaskStatus, number>;
  failed: { taskId: string; title: string; agent: string; error: string | null }[];
  pendingApprovals: number;
  externalItems: { approvalId: string; taskId: string; action: ActionClass; status: ExternalItemStatus }[];
  /** Statements computed from data. Each one is a count, never a claim about an external action. */
  statements: string[];
}

export function buildExecutiveReport(input: {
  now: Date;
  tasks: TaskRecord[];
  approvals: ApprovalRecord[];
  /** Exact counts over every task, when the caller has them. Otherwise counted from `tasks`. */
  counts?: Record<TaskStatus, number>;
}): ExecutiveReport {
  const counts = input.counts ?? (Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>);
  if (!input.counts) for (const t of input.tasks) counts[t.status] += 1;

  const failed = input.tasks
    .filter((t) => t.status === "failed")
    .map((t) => ({ taskId: t.id, title: t.title, agent: t.agent, error: t.lastError }));

  const pending = input.approvals.filter((a) => a.status === "pending");
  const externalItems: ExecutiveReport["externalItems"] = [];
  for (const approval of input.approvals) {
    const status = externalStatusFor(approval);
    if (status !== null) {
      externalItems.push({ approvalId: approval.id, taskId: approval.taskId, action: approval.actionClass, status });
    }
  }

  const statements = [
    `${counts.succeeded} task(s) succeeded, ${counts.running} running, ${counts.ready} ready.`,
    `${pending.length} approval(s) waiting for the owner.`,
    `${counts.failed} task(s) failed and need attention.`,
    `${counts.blocked} task(s) are blocked by an upstream failure or rejection.`,
  ];
  if (externalItems.length > 0) {
    statements.push(`${externalItems.length} external action(s) are waiting for the owner to perform manually. None were executed by the platform.`);
  }

  return {
    generatedAt: input.now.toISOString(),
    counts,
    failed,
    pendingApprovals: pending.length,
    externalItems,
    statements,
  };
}

/** Returns problems found in a report. An empty list means the report makes no unsupported claims. */
export function verifyReportHonesty(report: ExecutiveReport): string[] {
  const problems: string[] = [];
  const allowed: ExternalItemStatus[] = ["awaiting_owner_approval", "awaiting_owner_execution", "rejected", "expired"];
  for (const item of report.externalItems) {
    if (!allowed.includes(item.status)) problems.push(`External item ${item.approvalId} has status "${item.status}".`);
  }
  for (const line of report.statements) {
    if (/\b(published|sent|paid|deployed|completed external)\b/i.test(line)) {
      problems.push(`Statement claims an external action happened: "${line}"`);
    }
  }
  return problems;
}
