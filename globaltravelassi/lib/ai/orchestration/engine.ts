import { z } from "zod";
import { ApprovalService, ForbiddenActorError } from "../approvals";
import type { AuditSink } from "../audit";
import { checkCompliance } from "../workflows/compliance-rules";
import { summarizeAggregates, validateVisaRequirements, type VisaRequirementInput } from "../workflows/deterministic";
import { getWorkflow, WORKFLOW_TEMPLATES, type WorkflowKey, type WorkflowStep } from "../workflows/templates";
import { getAgent } from "../registry";
import { AgentRuntime, OutputValidationError, InputValidationError } from "../runtime";
import { ProviderError } from "../llm/types";
import type { Logger } from "../logging";
import { assertValidGraph, computeReadiness, downstreamOf, type GraphNode } from "./graph";
import { backoffDelayMs, DEFAULT_RETRY_POLICY, shouldRetry } from "./retry";
import type { AgentRunRecord, TaskRecord } from "./records";
import type { TaskStore, NewTask } from "./store";
import { COUNTRIES, LANGUAGES, type Actor, type AgentInput, type TaskStatus } from "../types";
import { aggregateRowSchema } from "../workflows/deterministic";

export const startWorkflowSchema = z.object({
  workflowKey: z.enum(Object.keys(WORKFLOW_TEMPLATES) as [WorkflowKey, ...WorkflowKey[]]),
  objective: z.string().min(3).max(2000),
  language: z.enum(LANGUAGES),
  country: z.enum(COUNTRIES),
  brief: z.string().max(4000).default(""),
  data: z.record(z.string().max(60), z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).default({}),
  aggregates: z.array(aggregateRowSchema).max(1000).default([]),
  idempotencyKey: z.string().min(8).max(120),
  createdBy: z.string().min(1).max(120),
});
export type StartWorkflowInput = z.infer<typeof startWorkflowSchema>;

export interface OrchestratorDeps {
  store: TaskStore;
  runtime: AgentRuntime;
  approvals: ApprovalService;
  audit: AuditSink;
  logger: Logger;
  now: () => Date;
  newId: () => string;
  /** Owner-approved hosts for visa research sources. Empty by default: nothing passes until the owner sets it. */
  visaAllowlist: () => string[];
}

export interface TickReport {
  claimed: number;
  succeeded: number;
  waitingApproval: number;
  retried: number;
  failed: number;
}

const TERMINAL_FAILURE = "terminal";

export class Orchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  private async audit(actor: string, type: string, entityType: string, entityId: string, meta: Record<string, unknown> = {}) {
    await this.deps.audit.write({
      id: this.deps.newId(),
      ts: this.deps.now().toISOString(),
      actor,
      type,
      entityType,
      entityId,
      meta,
    });
  }

  /** Creates a workflow run and its tasks. Calling it twice with the same idempotency key creates nothing new. */
  async startWorkflow(raw: StartWorkflowInput): Promise<{ runId: string; created: boolean; taskIds: string[] }> {
    const input = startWorkflowSchema.parse(raw);
    const template = getWorkflow(input.workflowKey);
    const now = this.deps.now();
    const runId = this.deps.newId();

    const idByStep = new Map<string, string>();
    for (const s of template.steps) idByStep.set(s.key, this.deps.newId());

    const tasks: NewTask[] = template.steps.map((s: WorkflowStep) => {
      const agent = getAgent(s.agent);
      const due = s.dueInHours ? new Date(now.getTime() + s.dueInHours * 3_600_000).toISOString() : null;
      const taskInput: AgentInput = {
        objective: input.objective,
        language: input.language,
        country: input.country,
        brief: input.brief,
        data: input.data,
        aggregates: input.aggregates,
        upstream: [],
      };
      return {
        id: idByStep.get(s.key) as string,
        runId,
        workflowKey: input.workflowKey,
        stepKey: s.key,
        agent: s.agent,
        title: s.title,
        status: "pending" as TaskStatus,
        priority: s.priority,
        dueAt: due,
        dependsOn: s.dependsOn.map((d) => idByStep.get(d) as string),
        input: taskInput,
        output: null,
        actionClass: s.approval?.actionClass ?? null,
        requiresApproval: s.approval !== null,
        attempts: 0,
        maxAttempts: agent.maxAttempts,
        nextRunAt: now.toISOString(),
        lastError: null,
      };
    });

    assertValidGraph(
      tasks.map((t): GraphNode => ({ id: t.id, status: t.status, dependsOn: t.dependsOn })),
    );

    const result = await this.deps.store.createRun(
      {
        id: runId,
        workflowKey: input.workflowKey,
        objective: input.objective,
        idempotencyKey: input.idempotencyKey,
        createdBy: input.createdBy,
        createdAt: now.toISOString(),
      },
      tasks,
    );

    if (result.created) {
      await this.audit("owner:" + input.createdBy, "workflow.started", "workflow_run", result.run.id, {
        workflowKey: input.workflowKey,
        taskCount: tasks.length,
      });
    }
    return { runId: result.run.id, created: result.created, taskIds: tasks.map((t) => t.id) };
  }

  /** One scheduling pass: updates readiness, claims due tasks and runs them. Safe to call repeatedly. */
  async tick(options: { limit?: number } = {}): Promise<TickReport> {
    const report: TickReport = { claimed: 0, succeeded: 0, waitingApproval: 0, retried: 0, failed: 0 };
    const tasks = await this.deps.store.listTasks();
    const nodes: GraphNode[] = tasks.map((t) => ({ id: t.id, status: t.status, dependsOn: t.dependsOn }));
    const changes = computeReadiness(nodes);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const nowIso = this.deps.now().toISOString();

    for (const id of changes.toReady) await this.deps.store.transitionTask(id, "pending", "ready", {}, nowIso);
    for (const id of changes.toBlocked) {
      const from = byId.get(id)?.status as TaskStatus;
      await this.deps.store.transitionTask(id, from, "blocked", {}, nowIso);
    }
    for (const id of changes.toPending) await this.deps.store.transitionTask(id, "blocked", "pending", {}, nowIso);

    const claimed = await this.deps.store.claimReady(nowIso, options.limit ?? 5);
    report.claimed = claimed.length;
    for (const task of claimed) {
      const outcome = await this.process(task);
      report[outcome] += 1;
    }
    return report;
  }

  private async upstreamOutputs(task: TaskRecord): Promise<unknown[]> {
    const outputs: unknown[] = [];
    for (const depId of task.dependsOn) {
      const dep = await this.deps.store.getTask(depId);
      if (dep && dep.status === "succeeded") outputs.push({ step: dep.stepKey, agent: dep.agent, output: dep.output });
    }
    return outputs;
  }

  private async process(task: TaskRecord): Promise<"succeeded" | "waitingApproval" | "retried" | "failed"> {
    const step = this.stepFor(task);
    const startedAt = this.deps.now();
    const actor = `agent:${task.agent}`;
    try {
      const upstream = await this.upstreamOutputs(task);
      const input: AgentInput = { ...task.input, upstream };
      const result = step.deterministic
        ? this.runDeterministic(step.deterministic, input)
        : await this.runAgent(task, input);

      await this.deps.store.saveArtifact({
        id: this.deps.newId(),
        taskId: task.id,
        agent: task.agent,
        kind: step.deterministic ? step.deterministic : getAgent(task.agent).outputKind,
        language: task.input.language,
        country: task.input.country,
        body: result.output,
        status: "draft",
        source: result.source,
        promptVersion: result.promptVersion,
      });

      await this.recordRun(task, result.providerId, "succeeded", result.tokensIn, result.tokensOut, startedAt, null, result.promptVersion);

      if (step.approval) {
        await this.deps.store.transitionTask(task.id, "running", "waiting_approval", { output: result.output, requiresApproval: true }, this.deps.now().toISOString());
        await this.deps.approvals.request({
          taskId: task.id,
          artifactId: null,
          actionClass: step.approval.actionClass,
          riskLevel: step.approval.riskLevel,
          summary: `${task.title}: ${step.approval.actionClass}`,
          preview: result.output,
          requestedBy: { kind: "agent", agent: task.agent },
        });
        await this.audit(actor, "task.waiting_approval", "task", task.id, { action: step.approval.actionClass });
        return "waitingApproval";
      }

      await this.deps.store.transitionTask(task.id, "running", "succeeded", { output: result.output, lastError: null }, this.deps.now().toISOString());
      await this.audit(actor, "task.succeeded", "task", task.id, { source: result.source });
      return "succeeded";
    } catch (error) {
      return this.handleFailure(task, error, startedAt);
    }
  }

  private stepFor(task: TaskRecord): WorkflowStep {
    const template = getWorkflow(task.workflowKey as WorkflowKey);
    const step = template.steps.find((s) => s.key === task.stepKey);
    if (!step) throw new Error(`Unknown step ${task.stepKey} for task ${task.id}.`);
    return step;
  }

  private async runAgent(task: TaskRecord, input: AgentInput) {
    const def = getAgent(task.agent);
    const result = await this.deps.runtime.run(def, input);
    if (task.agent === "ComplianceAgent") {
      const text = JSON.stringify(input.upstream);
      const rules = checkCompliance(text);
      if (rules.verdict === "fail") {
        throw new OutputValidationError(`compliance_blocked: ${rules.flags.map((f) => f.rule).join(", ")}`);
      }
      return { ...result, output: { ...(result.output as object), flags: rules.flags } };
    }
    return result;
  }

  private runDeterministic(kind: "analytics.aggregate" | "visa.validate", input: AgentInput) {
    if (kind === "analytics.aggregate") {
      const summary = summarizeAggregates(input.aggregates);
      return { output: summary, source: "deterministic" as const, promptVersion: "deterministic", providerId: "none", tokensIn: 0, tokensOut: 0 };
    }
    const upstream = input.upstream as { output?: { requirements?: VisaRequirementInput[] } }[];
    const requirements = upstream.flatMap((u) => u.output?.requirements ?? []);
    const check = validateVisaRequirements(requirements, this.deps.visaAllowlist(), this.deps.now());
    if (!check.ok) {
      throw new OutputValidationError(`visa_validation_failed: ${check.issues.length} issue(s)`);
    }
    return { output: { requirements, validated: true }, source: "deterministic" as const, promptVersion: "deterministic", providerId: "none", tokensIn: 0, tokensOut: 0 };
  }

  private async recordRun(
    task: TaskRecord,
    providerId: string,
    status: "succeeded" | "failed",
    tokensIn: number,
    tokensOut: number,
    startedAt: Date,
    error: string | null,
    promptVersion: string,
  ): Promise<void> {
    const finishedAt = this.deps.now();
    const record: AgentRunRecord = {
      id: this.deps.newId(),
      taskId: task.id,
      agent: task.agent,
      attempt: task.attempts,
      promptVersion,
      providerId: providerId === "none" ? null : providerId,
      status,
      tokensIn,
      tokensOut,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      error,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
    };
    await this.deps.store.saveAgentRun(record);
  }

  private async handleFailure(task: TaskRecord, error: unknown, startedAt: Date): Promise<"retried" | "failed"> {
    const message = error instanceof Error ? error.message : "Unknown error";
    const retryable = error instanceof ProviderError ? error.retryable : false;
    const terminal = error instanceof InputValidationError || error instanceof OutputValidationError || !retryable;
    await this.recordRun(task, "none", "failed", 0, 0, startedAt, message, getAgent(task.agent).prompt.version);

    if (!terminal && shouldRetry(task.attempts, retryable, { ...DEFAULT_RETRY_POLICY, maxAttempts: task.maxAttempts })) {
      const delay = backoffDelayMs(task.attempts);
      const next = new Date(this.deps.now().getTime() + delay).toISOString();
      await this.deps.store.transitionTask(task.id, "running", "ready", { lastError: message, nextRunAt: next }, this.deps.now().toISOString());
      await this.audit(`agent:${task.agent}`, "task.retry_scheduled", "task", task.id, { attempt: task.attempts, delayMs: delay, error: message });
      return "retried";
    }

    await this.deps.store.transitionTask(task.id, "running", "failed", { lastError: message }, this.deps.now().toISOString());
    await this.audit(`agent:${task.agent}`, "task.failed", "task", task.id, { error: message, terminal: TERMINAL_FAILURE });
    this.deps.logger.error("task.failed", { taskId: task.id, agent: task.agent, error: message });
    return "failed";
  }

  /** Owner-only. Approving an external action creates an owner action card; nothing is executed. */
  async decideApproval(approvalId: string, decision: "approved" | "rejected", actor: Actor, note: string | null) {
    if (actor.kind !== "owner") throw new ForbiddenActorError("Only the owner can decide an approval.");
    const { approval } = await this.deps.approvals.decide(approvalId, decision, actor, note);
    const task = await this.deps.store.getTask(approval.taskId);
    if (!task) throw new Error(`Task ${approval.taskId} not found.`);
    const nowIso = this.deps.now().toISOString();
    if (decision === "approved") {
      await this.deps.store.transitionTask(task.id, "waiting_approval", "succeeded", { lastError: null }, nowIso);
    } else {
      await this.deps.store.transitionTask(task.id, "waiting_approval", "cancelled", { lastError: "Rejected by owner." }, nowIso);
    }
    return { taskId: task.id, decision };
  }

  /** Owner-only. Puts a failed task back in the queue. */
  async retryTask(taskId: string, actor: Actor): Promise<void> {
    if (actor.kind !== "owner") throw new ForbiddenActorError("Only the owner can retry a task.");
    const task = await this.deps.store.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found.`);
    const nowIso = this.deps.now().toISOString();
    await this.deps.store.transitionTask(taskId, "failed", "ready", { attempts: 0, lastError: null, nextRunAt: nowIso }, nowIso);
    await this.audit(`owner:${actor.id}`, "task.retry_requested", "task", taskId, {});
  }

  /** Every task that depends on a failed or cancelled task is listed here, for the COO escalation. */
  async impactOf(taskId: string): Promise<string[]> {
    const tasks = await this.deps.store.listTasks();
    const nodes: GraphNode[] = tasks.map((t) => ({ id: t.id, status: t.status, dependsOn: t.dependsOn }));
    return downstreamOf(nodes, taskId);
  }
}

export const KNOWN_TEMPLATES = Object.keys(WORKFLOW_TEMPLATES) as WorkflowKey[];
