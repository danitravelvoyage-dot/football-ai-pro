import type { ActionClass, AgentInput, AgentKey, TaskStatus } from "../types";

export interface WorkflowRunRecord {
  id: string;
  workflowKey: string;
  objective: string;
  idempotencyKey: string;
  createdAt: string;
  createdBy: string;
}

export interface TaskRecord {
  id: string;
  runId: string;
  workflowKey: string;
  stepKey: string;
  agent: AgentKey;
  title: string;
  status: TaskStatus;
  priority: number;
  dueAt: string | null;
  dependsOn: string[];
  input: AgentInput;
  output: unknown | null;
  actionClass: ActionClass | null;
  requiresApproval: boolean;
  attempts: number;
  maxAttempts: number;
  nextRunAt: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactRecord {
  id: string;
  taskId: string | null;
  agent: AgentKey;
  kind: string;
  language: string;
  country: string;
  body: unknown;
  status: "draft" | "awaiting_owner" | "approved" | "rejected";
  source: "mock" | "live" | "deterministic";
  promptVersion: string | null;
  createdAt: string;
}

export interface ApprovalRecord {
  id: string;
  taskId: string;
  artifactId: string | null;
  actionClass: ActionClass;
  riskLevel: "low" | "medium" | "high";
  summary: string;
  preview: unknown;
  status: "pending" | "approved" | "rejected" | "expired";
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  /** When a pending approval stops being valid. Null only for actions that need no approval. */
  expiresAt: string | null;
  /** Fingerprint of the exact action. Changing the payload changes it, which invalidates the approval. */
  payloadHash: string;
  /** Set once, when an approved action has produced its owner card. Prevents a second card. */
  executedAt: string | null;
  createdAt: string;
}

export interface AgentRunRecord {
  id: string;
  taskId: string;
  agent: AgentKey;
  attempt: number;
  promptVersion: string;
  providerId: string | null;
  status: "succeeded" | "failed";
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  error: string | null;
  startedAt: string;
  finishedAt: string;
}
