import { z } from "zod";
import { ApprovalExpiredError, ApprovalService, ForbiddenActorError } from "../approvals";
import type { AuditSink } from "../audit";
import { checkCompliance } from "../workflows/compliance-rules";
import { summarizeAggregates, validateVisaRequirements, type VisaRequirementInput } from "../workflows/deterministic";
import { getWorkflow, WORKFLOW_TEMPLATES, type WorkflowKey, type WorkflowStep } from "../workflows/templates";
import { getAgent } from "../registry";
import { AgentRuntime, OutputValidationError, InputValidationError } from "../runtime";
import { ProviderError } from "../llm/types";
import type { Logger } from "../logging";
import { assertValidGraph, computeReadiness, type GraphNode } from "./graph";
import { impactOfTask } from "./impact";
import type { EventBus, PublishInput } from "../events/bus";
import type { ContextService } from "../context/service";
import type { KbService } from "../knowledge/service";
import type { QualityController } from "../quality/controller";
import { claimsOf } from "../quality/extract";
import { taskFailedNotice, type Notice } from "../notifications/rules";
import type { Claim } from "../quality/types";
import { backoffDelayMs, DEFAULT_RETRY_POLICY, shouldRetry } from "./retry";
import type { AgentRunRecord, TaskRecord } from "./records";
import { ConcurrencyError, type TaskStore, type NewTask } from "./store";
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
  /** Event bus for state changes. Events are a side channel: a failed publish never changes task state. */
  events: EventBus;
  /** Shared context. Each agent receives only what its access rules allow. */
  context: ContextService;
  /** Knowledge base. Each agent receives only verified, current facts for its role. */
  knowledge: KbService;
  /** Quality controller. Every model output is reviewed before it is stored or used. */
  quality: QualityController;
  /**
   * Owner memory prepared for agents (decisions, evidence-backed learning). Optional: when absent, agents run
   * with shared context only. Called by the platform for each agent task; agents never call it.
   */
  briefing?: () => Promise<{ scope: string; key: string; value: unknown }[]>;
  /** Owner inbox. A terminal task failure is reported here. A failed notice never changes task state. */
  notify?: (notice: Notice) => Promise<unknown>;
}

export interface TickReport {
  claimed: number;
  succeeded: number;
  waitingApproval: number;
  retried: number;
  failed: number;
  /** Approvals whose time ran out during this pass. Their waiting tasks were cancelled. */
  expiredApprovals: number;
  /** Tasks left in "running" by an interrupted worker and put back in the queue (or failed at the attempt limit). */
  recoveredTasks: number;
  /** Open tasks whose due time has passed. Counted, not changed. */
  overdueTasks: number;
  /** Event deliveries handled by this pass. */
  eventsDelivered: number;
  eventsRetried: number;
  eventsDead: number;
}

/** A running task with no progress for this long is treated as interrupted. Real runs take seconds. */
export const STALE_RUNNING_MS = 15 * 60_000;

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
        context: [],
        knowledge: [],
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
      await this.saveRunBrief(runId, input.brief, input.createdBy);
      await this.publishSafely({
        type: "workflow.started",
        producer: "COOAgent",
        payload: { runId: result.run.id, workflowKey: input.workflowKey, taskCount: tasks.length },
        idempotencyKey: `workflow.started:${result.run.id}`,
        correlationId: result.run.id,
      });
    }
    return { runId: result.run.id, created: result.created, taskIds: tasks.map((t) => t.id) };
  }

  /** One scheduling pass: updates readiness, claims due tasks and runs them. Safe to call repeatedly. */
  async tick(options: { limit?: number } = {}): Promise<TickReport> {
    const report: TickReport = {
      claimed: 0,
      succeeded: 0,
      waitingApproval: 0,
      retried: 0,
      failed: 0,
      expiredApprovals: 0,
      recoveredTasks: 0,
      overdueTasks: 0,
      eventsDelivered: 0,
      eventsRetried: 0,
      eventsDead: 0,
    };
    report.expiredApprovals = await this.expireApprovals();
    report.recoveredTasks = await this.recoverStaleTasks();
    await this.applyReadiness();
    const nowIso = this.deps.now().toISOString();

    const claimed = await this.deps.store.claimReady(nowIso, options.limit ?? 5);
    report.claimed = claimed.length;
    for (const task of claimed) {
      const outcome = await this.process(task);
      report[outcome] += 1;
    }
    // Readiness again, so a failure or a block reaches its dependants within this same pass.
    await this.applyReadiness();
    report.overdueTasks = await this.countOverdue();
    const dispatched = await this.dispatchEvents();
    report.eventsDelivered = dispatched.delivered;
    report.eventsRetried = dispatched.retried;
    report.eventsDead = dispatched.dead;
    return report;
  }

  /** Open tasks whose due time has passed. Read-only. */
  private async countOverdue(): Promise<number> {
    const nowMs = this.deps.now().getTime();
    const open = await this.deps.store.listOpenTasks();
    return open.filter((t) => t.dueAt !== null && Date.parse(t.dueAt) < nowMs).length;
  }

  /**
   * Crash recovery. A task stays "running" only while a worker is processing it. If the worker stopped
   * (process killed, host restarted), no one moves it on. Here a task that has been running longer than
   * STALE_RUNNING_MS is returned to the queue, or failed once it has used its attempts. Each change is a
   * compare-and-set on the status, so a task that another pass already moved is left alone.
   */
  async recoverStaleTasks(staleAfterMs: number = STALE_RUNNING_MS): Promise<number> {
    const nowMs = this.deps.now().getTime();
    const nowIso = this.deps.now().toISOString();
    const open = await this.deps.store.listOpenTasks();
    let recovered = 0;
    for (const task of open) {
      if (task.status !== "running" || Date.parse(task.updatedAt) + staleAfterMs > nowMs) continue;
      const exhausted = task.attempts >= task.maxAttempts;
      try {
        if (exhausted) {
          const reason = "Interrupted before completion, and the attempt limit was reached.";
          await this.deps.store.transitionTask(task.id, "running", "failed", { lastError: reason }, nowIso);
          await this.publishSafely({
            type: "task.failed",
            producer: "system",
            payload: { taskId: task.id, runId: task.runId, agent: task.agent, stepKey: task.stepKey, error: reason, terminal: true },
            idempotencyKey: `task.failed:${task.id}:recovered:${task.attempts}`,
            correlationId: task.runId,
          });
        } else {
          await this.deps.store.transitionTask(task.id, "running", "ready", { lastError: "Recovered after an interrupted run.", nextRunAt: nowIso }, nowIso);
        }
        await this.audit("system", exhausted ? "task.recovery_failed" : "task.recovered", "task", task.id, { attempts: task.attempts, maxAttempts: task.maxAttempts });
        recovered += 1;
      } catch (error) {
        // Another pass moved this task first. That is the expected outcome of the compare-and-set, not an error.
        if (error instanceof ConcurrencyError) continue;
        throw error;
      }
    }
    return recovered;
  }

  /** Moves tasks between pending, ready and blocked from the state of their dependencies. */
  private async applyReadiness(): Promise<void> {
    // Every open task, with no row cap, plus the finished dependencies they wait on.
    const open = await this.deps.store.listOpenTasks();
    const openIds = new Set(open.map((t) => t.id));
    const missing = [...new Set(open.flatMap((t) => t.dependsOn))].filter((id) => !openIds.has(id));
    const finished = missing.length > 0 ? await this.deps.store.getTasksByIds(missing) : [];
    const tasks = [...open, ...finished];
    const nodes: GraphNode[] = tasks.map((t) => ({ id: t.id, status: t.status, dependsOn: t.dependsOn }));
    const changes = computeReadiness(nodes);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const nowIso = this.deps.now().toISOString();

    for (const id of changes.toReady) {
      await this.deps.store.transitionTask(id, "pending", "ready", {}, nowIso);
      const task = byId.get(id);
      if (task) await this.publishSafely(readyEvent(task, `task.ready:${task.id}:${this.deps.newId()}`));
    }
    for (const id of changes.toBlocked) {
      const from = byId.get(id)?.status as TaskStatus;
      await this.deps.store.transitionTask(id, from, "blocked", {}, nowIso);
    }
    for (const id of changes.toPending) await this.deps.store.transitionTask(id, "blocked", "pending", {}, nowIso);
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
      const shared = await this.deps.context.forAgent(task.agent, task.runId);
      const briefing = step.deterministic || !this.deps.briefing ? [] : await this.deps.briefing();
      const feedback = step.deterministic ? [] : await this.revisionFeedback(task);
      const context = [...briefing, ...feedback, ...shared];
      const knowledge = step.deterministic
        ? []
        : await this.deps.knowledge.forAgent(task.agent, { country: task.input.country, language: task.input.language });
      await this.audit(actor, "agent.inputs_loaded", "task", task.id, {
        context: context.length,
        briefing: briefing.length,
        revisionFeedback: feedback.length,
        knowledge: knowledge.length,
      });
      const input: AgentInput = { ...task.input, upstream, context, knowledge };
      const result = step.deterministic
        ? this.runDeterministic(step.deterministic, input)
        : await this.runAgent(task, input);

      if (!step.deterministic) {
        const gate = await this.qualityGate(task, result.output, input);
        if (gate !== "accept") return gate;
      }

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
        await this.publishSafely({
          type: "task.waiting_approval",
          producer: task.agent,
          payload: { taskId: task.id, runId: task.runId, agent: task.agent, actionClass: step.approval.actionClass },
          idempotencyKey: `task.waiting_approval:${task.id}`,
          correlationId: task.runId,
        });
        return "waitingApproval";
      }

      await this.deps.store.transitionTask(task.id, "running", "succeeded", { output: result.output, lastError: null }, this.deps.now().toISOString());
      await this.audit(actor, "task.succeeded", "task", task.id, { source: result.source });
      await this.publishSafely({
        type: "task.succeeded",
        producer: task.agent,
        payload: { taskId: task.id, runId: task.runId, agent: task.agent, stepKey: task.stepKey },
        idempotencyKey: `task.succeeded:${task.id}`,
        correlationId: task.runId,
      });
      await this.publishHandoffs(task);
      return "succeeded";
    } catch (error) {
      return this.handleFailure(task, error, startedAt);
    }
  }

  /**
   * Runs the quality review on a model output and acts on the status:
   * PASSED continues; NEEDS_REVISION returns the task to the queue with feedback; REJECTED fails it;
   * REQUIRES_HUMAN_REVIEW asks the owner through the approval engine.
   */
  private async qualityGate(
    task: TaskRecord,
    output: unknown,
    input: AgentInput,
  ): Promise<"accept" | "retried" | "failed" | "waitingApproval"> {
    const def = getAgent(task.agent);
    const nowIso = this.deps.now().toISOString();
    const previous = await this.deps.quality.history({ kind: "system" }, task.id);
    const peers: Claim[] = (await this.deps.store.listTasksByRunIds([task.runId]))
      .filter((t) => t.id !== task.id && t.status === "succeeded" && t.output !== null)
      .flatMap((t) => claimsOf(t.agent, getAgent(t.agent).outputKind, t.output));
    const review = await this.deps.quality.reviewAndRecord({
      taskId: task.id,
      runId: task.runId,
      agent: task.agent,
      outputKind: def.outputKind,
      output,
      schema: def.outputSchema,
      language: input.language,
      allowlist: this.deps.visaAllowlist(),
      peerClaims: peers,
      attempt: previous.length + 1,
    });
    const codes = [...new Set(review.issues.filter((i) => i.severity !== "info").map((i) => i.code))].join(", ") || "none";

    if (review.status === "PASSED") return "accept";

    if (review.status === "NEEDS_REVISION") {
      await this.deps.store.transitionTask(task.id, "running", "ready", { lastError: `Revision requested: ${codes}`, nextRunAt: nowIso }, nowIso);
      await this.audit(`agent:${task.agent}`, "task.revision_requested", "task", task.id, { attempt: review.attempt, codes });
      return "retried";
    }

    if (review.status === "REJECTED") {
      const reason = `Quality rejected the output: ${codes}`;
      await this.deps.store.transitionTask(task.id, "running", "failed", { lastError: reason }, nowIso);
      await this.audit(`agent:${task.agent}`, "task.quality_rejected", "task", task.id, { attempt: review.attempt, codes });
      await this.notifyFailure(task, reason);
      await this.publishSafely({
        type: "task.failed",
        producer: task.agent,
        payload: { taskId: task.id, runId: task.runId, agent: task.agent, stepKey: task.stepKey, error: reason.slice(0, 500), terminal: true },
        idempotencyKey: `task.failed:${task.id}:${this.deps.newId()}`,
        correlationId: task.runId,
      });
      return "failed";
    }

    // REQUIRES_HUMAN_REVIEW: the owner decides through the approval engine. The output is held until then.
    await this.deps.store.transitionTask(task.id, "running", "waiting_approval", { output, requiresApproval: true }, nowIso);
    await this.deps.approvals.request({
      taskId: task.id,
      artifactId: null,
      actionClass: "propose_change",
      riskLevel: "medium",
      summary: `Human review needed (${codes}): ${task.title}`.slice(0, 500),
      preview: { output, quality: { status: review.status, overall: review.overall, codes } },
      requestedBy: { kind: "system" },
    });
    await this.audit(`agent:${task.agent}`, "task.waiting_approval", "task", task.id, { reason: "quality_human_review", codes });
    return "waitingApproval";
  }

  /**
   * The feedback from the latest review, but only when that review asked for a revision. Once a later review
   * has passed or been rejected, the old feedback is no longer sent. Feedback holds locations and instructions,
   * never the reviewed text.
   */
  private async revisionFeedback(task: TaskRecord): Promise<{ scope: string; key: string; value: unknown }[]> {
    const reviews = [...(await this.deps.quality.history({ kind: "system" }, task.id))].sort((a, b) => a.attempt - b.attempt);
    const latest = reviews.at(-1);
    if (!latest || latest.status !== "NEEDS_REVISION" || latest.feedback.length === 0) return [];
    return [{ scope: "revision", key: "quality.feedback", value: { attempt: latest.attempt, feedback: latest.feedback } }];
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
    await this.notifyFailure(task, message);
    this.deps.logger.error("task.failed", { taskId: task.id, agent: task.agent, error: message });
    await this.publishSafely({
      type: "task.failed",
      producer: task.agent,
      payload: { taskId: task.id, runId: task.runId, agent: task.agent, stepKey: task.stepKey, error: message.slice(0, 500), terminal: true },
      // A task can fail terminally once per attempt cycle, and a retry can repeat that. Each event gets its own key.
      idempotencyKey: `task.failed:${task.id}:${this.deps.newId()}`,
      correlationId: task.runId,
    });
    return "failed";
  }

  /** Expires due approvals and cancels the tasks that were waiting for them. Runs at the start of every pass. */
  async expireApprovals(): Promise<number> {
    const expired = await this.deps.approvals.expireDue();
    for (const approval of expired) {
      await this.cancelWaitingTask(approval.taskId, "Approval expired before the owner decided.");
    }
    return expired.length;
  }

  private async cancelWaitingTask(taskId: string, reason: string): Promise<void> {
    const task = await this.deps.store.getTask(taskId);
    if (!task || task.status !== "waiting_approval") return;
    await this.deps.store.transitionTask(taskId, "waiting_approval", "cancelled", { lastError: reason }, this.deps.now().toISOString());
    await this.audit("system", "task.cancelled", "task", taskId, { reason });
  }

  /** Owner-only. Approving an external action creates an owner action card; nothing is executed. */
  async decideApproval(approvalId: string, decision: "approved" | "rejected", actor: Actor, note: string | null) {
    if (actor.kind !== "owner") throw new ForbiddenActorError("Only the owner can decide an approval.");
    let decided: Awaited<ReturnType<ApprovalService["decide"]>>;
    try {
      decided = await this.deps.approvals.decide(approvalId, decision, actor, note);
    } catch (error) {
      if (error instanceof ApprovalExpiredError) {
        await this.cancelWaitingTask(error.taskId, "Approval expired before the owner decided.");
      }
      throw error;
    }
    const { approval } = decided;
    const task = await this.deps.store.getTask(approval.taskId);
    if (!task) throw new Error(`Task ${approval.taskId} not found.`);
    const nowIso = this.deps.now().toISOString();
    if (decision === "approved") {
      await this.deps.store.transitionTask(task.id, "waiting_approval", "succeeded", { lastError: null }, nowIso);
    } else {
      await this.deps.store.transitionTask(task.id, "waiting_approval", "cancelled", { lastError: "Rejected by owner." }, nowIso);
    }
    await this.publishSafely({
      type: "approval.decided",
      producer: "owner",
      payload: { approvalId, taskId: task.id, decision, actionClass: approval.actionClass },
      idempotencyKey: `approval.decided:${approvalId}`,
      correlationId: task.runId,
    });
    return { taskId: task.id, decision };
  }

  /** Owner-only. Puts a failed task back in the queue. */
  /**
   * Owner only. Cancels the tasks of a run that have not started (pending, ready, blocked or failed). A task that is
   * running finishes or fails on its own: an in-flight provider call cannot be stopped safely. A task waiting for an
   * approval is left for the owner's decision. Returns what was cancelled and what was left, with the reason.
   */
  async cancelRun(actor: Actor, runId: string): Promise<{ cancelled: string[]; left: { taskId: string; reason: string }[] }> {
    if (actor.kind !== "owner" || actor.id.trim().length === 0) throw new ForbiddenActorError("Only the owner can cancel a run.");
    const nowIso = this.deps.now().toISOString();
    const cancelled: string[] = [];
    const left: { taskId: string; reason: string }[] = [];
    for (const task of await this.deps.store.listTasksByRunIds([runId])) {
      if (task.status === "pending" || task.status === "ready" || task.status === "blocked" || task.status === "failed") {
        // Compare-and-set on the status read above, so a task another pass has just claimed is left alone.
        try {
          await this.deps.store.transitionTask(task.id, task.status, "cancelled", { lastError: "Cancelled by the owner." }, nowIso);
          cancelled.push(task.id);
        } catch {
          left.push({ taskId: task.id, reason: "changed_during_cancel" });
        }
      } else if (task.status === "waiting_approval") {
        left.push({ taskId: task.id, reason: "awaiting_owner_decision" });
      } else {
        left.push({ taskId: task.id, reason: task.status === "running" ? "running" : "already_finished" });
      }
    }
    await this.audit(`owner:${actor.id}`, "run.cancelled", "workflow_run", runId, { cancelled: cancelled.length, left: left.length });
    return { cancelled, left };
  }

  async retryTask(taskId: string, actor: Actor): Promise<void> {
    if (actor.kind !== "owner") throw new ForbiddenActorError("Only the owner can retry a task.");
    const task = await this.deps.store.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found.`);
    const nowIso = this.deps.now().toISOString();
    await this.deps.store.transitionTask(taskId, "failed", "ready", { attempts: 0, lastError: null, nextRunAt: nowIso }, nowIso);
    await this.audit(`owner:${actor.id}`, "task.retry_requested", "task", taskId, {});
    await this.publishSafely(readyEvent({ ...task, status: "ready" }, `task.ready:${taskId}:${this.deps.newId()}`));
  }

  /** Every task that depends on a failed or cancelled task is listed here, for the COO escalation. Dependencies stay inside one run. */
  async impactOf(taskId: string): Promise<string[]> {
    return impactOfTask(this.deps.store, taskId);
  }

  /** Keeps the run brief as workflow context, so every agent in the run reads the same brief. Never blocks the run. */
  private async saveRunBrief(runId: string, brief: string, createdBy: string): Promise<void> {
    if (brief.trim().length === 0) return;
    try {
      await this.deps.context.write({ kind: "owner", id: createdBy }, {
        scope: "workflow",
        scopeKey: runId,
        contextKey: "workflow.brief",
        value: { text: brief.slice(0, 4000) },
        expectedVersion: 0,
        visibility: "team",
        reason: "Run brief",
      });
    } catch (error) {
      this.deps.logger.error("context.brief_not_saved", { reason: error instanceof Error ? error.name : "unknown" });
    }
  }

  /** Reports a terminal failure to the owner. A failed notification is logged; it never changes task state. */
  private async notifyFailure(task: TaskRecord, reason: string): Promise<void> {
    if (!this.deps.notify) return;
    try {
      await this.deps.notify(taskFailedNotice(task, reason.slice(0, 300)));
    } catch (error) {
      this.deps.logger.error("notification.failed", { reason: error instanceof Error ? error.name : "unknown" });
    }
  }

  /** Publishes an event. A refused or failed publish is logged and never changes or blocks task state. */
  /**
   * Hands a finished task's result to the agents that depend on it. One handoff event per direct dependent that a
   * different agent will run. Handoffs are idempotent per (task, dependent) and carry only identifiers and a short
   * fixed summary: no output text, so no customer or model content travels in the event.
   */
  private async publishHandoffs(task: TaskRecord): Promise<void> {
    const tasks = await this.deps.store.listTasksByRunIds([task.runId]);
    const dependents = tasks.filter((t) => t.dependsOn.includes(task.id) && t.agent !== task.agent);
    for (const dependent of dependents) {
      await this.publishSafely({
        type: "agent.handoff",
        producer: task.agent,
        target: dependent.agent,
        payload: {
          fromAgent: task.agent,
          toAgent: dependent.agent,
          taskId: task.id,
          summary: `${task.agent} finished step ${task.stepKey}. Its reviewed output is available to ${dependent.agent} in this run.`,
        },
        idempotencyKey: `agent.handoff:${task.id}:${dependent.id}`,
        correlationId: task.runId,
        hopCount: 1,
      });
    }
  }

  private async publishSafely(input: PublishInput): Promise<void> {
    try {
      await this.deps.events.publish(input);
    } catch (error) {
      this.deps.logger.error("event.publish_failed", { type: input.type, reason: error instanceof Error ? error.name : "unknown" });
    }
  }

  private async dispatchEvents(): Promise<{ delivered: number; retried: number; dead: number }> {
    try {
      const r = await this.deps.events.dispatch({ limit: 100 });
      return { delivered: r.delivered, retried: r.retried, dead: r.dead };
    } catch (error) {
      this.deps.logger.error("event.dispatch_failed", { reason: error instanceof Error ? error.name : "unknown" });
      return { delivered: 0, retried: 0, dead: 0 };
    }
  }
}

/** The state machine moves a task to ready once per cycle. The key is unique per event, so a retry can announce readiness again. */
function readyEvent(task: TaskRecord, idempotencyKey: string): PublishInput {
  return {
    type: "task.ready",
    producer: "COOAgent",
    target: task.agent,
    payload: { taskId: task.id, runId: task.runId, agent: task.agent, stepKey: task.stepKey },
    idempotencyKey,
    correlationId: task.runId,
  };
}

export const KNOWN_TEMPLATES = Object.keys(WORKFLOW_TEMPLATES) as WorkflowKey[];
