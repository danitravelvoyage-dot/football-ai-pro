import { z } from "zod";
import type { AuditSink } from "../audit";
import { getAgent, type AgentDefinition } from "../registry";
import type { AgentInput, Actor, AgentKey } from "../types";
import { AGENT_KEYS } from "../types";
import type { EventBus } from "../events/bus";
import type { EventStore, DomainEventRecord } from "../events/store";
import type { AgentRuntime } from "../runtime";
import type { QualityController } from "../quality/controller";
import { decideGate } from "./gate";
import { validateAnswerSources } from "../factual/validate";
import type { ReviewOpenInput } from "../review/service";
import type { CollaborationStore } from "./store";
import { assertNoPersonalData, PersonalDataError } from "../security/personal-data";

/**
 * Agent-to-agent questions and answers, carried by the event bus.
 *
 * - A question is one hop from the asking agent. An answer is the second hop, from the answering agent back to the asker.
 * - An answer is produced by running the answering agent through the runtime, then reviewed by the same two-reviewer
 *   gate as any agent output. A held or failed answer is not delivered.
 * - No handler publishes anything in response to a question or an answer, so an exchange cannot start another one.
 * - A question is asked once: its idempotency key is its id, and an answer to it is refused once one exists.
 * - At most MAX_QUESTIONS_PER_RUN questions are asked in one run.
 * Only the owner or the system asks, on behalf of an agent. An agent cannot start an exchange itself.
 */

export const MAX_QUESTIONS_PER_RUN = 5;
const LANGUAGE = "en" as const;

/**
 * An answer and the sources it cites. Sources are checked by the factual layer, not here: a fabricated address must
 * reach that check, so it is refused for the right reason.
 */
export const ANSWER_SCHEMA = z.object({
  answer: z.string().trim().min(1).max(1000),
  sources: z.array(z.string().max(500)).max(5).default([]),
});

/** The answering agent's own prompt and boundaries, with an answer contract in place of its report contract. Pure. */
export function answerDefinition(agent: AgentKey): AgentDefinition {
  const base = getAgent(agent);
  return {
    ...base,
    outputKind: "answer",
    outputSchema: ANSWER_SCHEMA,
    // A short, explicit contract. The question is the task, so a small model answers it instead of echoing the input.
    prompt: {
      ...base.prompt,
      system: `You are ${base.name}. Answer the question in one short sentence, from your own role. Reply with JSON only, in exactly this form: {"answer": "<one short sentence>", "sources": []}. Put only web addresses you were given in sources; leave it empty if you have none.`,
    },
    timeoutMs: 30_000,
    mockOutput: () => ({ answer: "Mock answer." }),
  };
}

export class ExchangeError extends Error {
  constructor(
    message: string,
    public readonly code: "forbidden" | "invalid" | "limit" | "unknown_question" | "already_answered",
  ) {
    super(message);
    this.name = "ExchangeError";
  }
}

export interface ExchangeDeps {
  /** Opens an owner review item for a held answer. Optional: without it, held answers are only audited. */
  review?: { open(input: ReviewOpenInput): Promise<unknown> };
  /** Owner-approved source hosts. An answer is delivered automatically only when its sources are on this list. */
  approvedHosts?: () => string[];
  bus: EventBus;
  events: EventStore;
  runtime: AgentRuntime;
  quality: QualityController;
  collaboration: CollaborationStore;
  audit: AuditSink;
  now: () => Date;
  newId: () => string;
}

export interface ExchangeItem {
  questionId: string;
  runId: string;
  fromAgent: string;
  toAgent: string;
  question: string;
  answer: string | null;
  at: string;
}

function assertAsker(actor: Actor): void {
  if (actor.kind === "agent") throw new ExchangeError("Agents cannot start an exchange.", "forbidden");
  if (actor.kind === "owner" && actor.id.trim().length === 0) throw new ExchangeError("The owner identity is missing.", "forbidden");
}

export class CommunicationService {
  constructor(private readonly deps: ExchangeDeps) {}

  private nowIso(): string {
    return this.deps.now().toISOString();
  }

  async ask(actor: Actor, input: { runId: string; fromAgent: AgentKey; toAgent: AgentKey; question: string }): Promise<{ questionId: string }> {
    assertAsker(actor);
    if (!AGENT_KEYS.includes(input.fromAgent) || !AGENT_KEYS.includes(input.toAgent)) throw new ExchangeError("Unknown agent.", "invalid");
    if (input.fromAgent === input.toAgent) throw new ExchangeError("An agent cannot ask itself.", "invalid");
    const question = input.question.trim();
    if (question.length < 3 || question.length > 500) throw new ExchangeError("A question is 3 to 500 characters.", "invalid");
    try {
      assertNoPersonalData({ question });
    } catch (error) {
      if (error instanceof PersonalDataError) throw new ExchangeError("The question contains personal data and was refused.", "invalid");
      throw error;
    }
    const asked = (await this.exchanges(input.runId)).length;
    if (asked >= MAX_QUESTIONS_PER_RUN) throw new ExchangeError("This run has reached its question limit.", "limit");

    const questionId = this.deps.newId();
    await this.deps.bus.publish({
      type: "agent.question",
      producer: input.fromAgent,
      target: input.toAgent,
      payload: { fromAgent: input.fromAgent, toAgent: input.toAgent, questionId, runId: input.runId, question },
      idempotencyKey: `agent.question:${questionId}`,
      correlationId: input.runId,
      hopCount: 1,
    });
    await this.audit(actor, "agent.question_asked", questionId, { runId: input.runId, fromAgent: input.fromAgent, toAgent: input.toAgent });
    return { questionId };
  }

  /** Produces, reviews and, when the review passes, delivers the answer. Held and failed answers are audited. */
  async answer(actor: Actor, input: { runId: string; questionId: string }): Promise<{ status: "delivered" | "held" | "failed" }> {
    assertAsker(actor);
    const items = await this.exchanges(input.runId);
    const item = items.find((x) => x.questionId === input.questionId);
    if (!item) throw new ExchangeError("No such question in this run.", "unknown_question");
    if (item.answer !== null) throw new ExchangeError("This question has already been answered.", "already_answered");

    const def = answerDefinition(item.toAgent as AgentKey);
    const agentInput: AgentInput = {
      objective: "Answer the question in one short sentence.",
      language: LANGUAGE,
      country: "all",
      brief: item.question,
      data: {},
      aggregates: [],
      upstream: [],
      context: [],
      knowledge: [],
    };
    let output: unknown;
    try {
      output = (await this.deps.runtime.run(def, agentInput)).output;
    } catch (error) {
      await this.audit(actor, "agent.answer_failed", input.questionId, { runId: input.runId, reason: error instanceof Error ? error.name : "unknown" });
      return { status: "failed" };
    }

    const controllerReview = this.deps.quality.review({
      taskId: input.questionId,
      runId: input.runId,
      agent: item.toAgent,
      outputKind: "answer",
      output,
      schema: ANSWER_SCHEMA,
      language: LANGUAGE,
      allowlist: [],
      attempt: 1,
    });
    // A free-text answer is factual by nature. It is delivered automatically only when it cites approved sources.
    const cited = (output as { sources?: string[] }).sources ?? [];
    const gate = decideGate({
      producer: item.toAgent,
      outputKind: "answer",
      output,
      controllerStatus: controllerReview.status,
      controllerIssues: controllerReview.issues,
      attempt: 1,
      factual: validateAnswerSources(cited, this.deps.approvedHosts?.() ?? []),
    });
    await this.audit(actor, "agent.answer_reviewed", input.questionId, { status: gate.status, decision: gate.consensus.decision, reasons: gate.consensus.reasons });
    if (gate.status !== "PASSED") {
      await this.audit(actor, "agent.answer_held", input.questionId, { runId: input.runId, status: gate.status });
      if (this.deps.review) {
        // The answer waits in the approval center with its sources and the reasons it was held.
        await this.deps.review.open({
          kind: "held_answer",
          agent: item.toAgent,
          runId: input.runId,
          taskId: null,
          leadId: null,
          subjectRef: input.questionId,
          summary: `Answer from ${item.toAgent} to ${item.fromAgent} is held: ${gate.consensus.reasons.join(", ") || gate.status}.`,
          evidence: { gateStatus: gate.status, codes: gate.consensus.reasons, sources: cited },
          payload: { runId: input.runId, questionId: input.questionId, fromAgent: item.toAgent, toAgent: item.fromAgent, answer: (output as { answer: string }).answer, question: item.question },
        } as ReviewOpenInput);
      }
      return { status: "held" };
    }

    const answer = (output as { answer: string }).answer;
    await this.deps.bus.publish({
      type: "agent.answer",
      producer: item.toAgent,
      target: item.fromAgent,
      payload: { fromAgent: item.toAgent, toAgent: item.fromAgent, questionId: input.questionId, runId: input.runId, answer },
      idempotencyKey: `agent.answer:${input.questionId}`,
      correlationId: input.runId,
      hopCount: 2,
    });
    await this.audit(actor, "agent.answer_delivered", input.questionId, { runId: input.runId, fromAgent: item.toAgent, toAgent: item.fromAgent });
    return { status: "delivered" };
  }

  /**
   * Delivers an answer the owner approved from the approval center. The owner decides; the platform only publishes the
   * answer to its asker, one hop, as the answering agent. Nothing leaves the platform.
   */
  async deliverApproved(actor: Actor, p: { runId: string; questionId: string; fromAgent: AgentKey; toAgent: AgentKey; answer: string }): Promise<{ eventId: string }> {
    if (actor.kind !== "owner") throw new ExchangeError("Only the owner can deliver an approved answer.", "forbidden");
    const published = await this.deps.bus.publish({
      type: "agent.answer",
      producer: p.fromAgent,
      target: p.toAgent,
      payload: { fromAgent: p.fromAgent, toAgent: p.toAgent, questionId: p.questionId, runId: p.runId, answer: p.answer },
      idempotencyKey: `agent.answer:${p.questionId}`,
      correlationId: p.runId,
      hopCount: 2,
    });
    await this.audit(actor, "agent.answer_approved_delivered", p.questionId, { runId: p.runId, fromAgent: p.fromAgent, toAgent: p.toAgent });
    return { eventId: published.eventId };
  }

  /** The questions asked in a run and the answers delivered so far. Text is included: this is the owner's view. */
  async exchanges(runId: string): Promise<ExchangeItem[]> {
    // Filtered by the run in the store, so the list is exact for this run, however many runs exist.
    const page = await this.deps.events.listEvents({ eventType: "agent.question", correlationId: runId, limit: 500 });
    const answers = await this.deps.events.listEvents({ eventType: "agent.answer", correlationId: runId, limit: 500 });
    const answerByQuestion = new Map<string, string>();
    for (const e of answers.items) {
      const p = e.payload as { questionId: string; answer: string; runId: string };
      if (e.correlationId === runId) answerByQuestion.set(p.questionId, p.answer);
    }
    return page.items
      .filter((e: DomainEventRecord) => e.correlationId === runId)
      .map((e) => {
        const p = e.payload as { questionId: string; fromAgent: string; toAgent: string; question: string };
        return {
          questionId: p.questionId,
          runId,
          fromAgent: p.fromAgent,
          toAgent: p.toAgent,
          question: p.question,
          answer: answerByQuestion.get(p.questionId) ?? null,
          at: e.occurredAt,
        };
      })
      .sort((a, b) => a.at.localeCompare(b.at));
  }

  private async audit(actor: Actor, type: string, entityId: string, meta: Record<string, unknown>): Promise<void> {
    const by = actor.kind === "owner" ? `owner:${actor.id}` : "system";
    await this.deps.audit.write({ id: this.deps.newId(), ts: this.nowIso(), actor: by, type, entityType: "exchange", entityId, meta });
  }
}
