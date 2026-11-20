import { buildBriefing, type BriefingItem } from "./briefing";
import { z } from "zod";
import type { AuditSink } from "../audit";
import { assertNoPersonalData, PersonalDataError } from "../security/personal-data";
import type { Actor } from "../types";
import {
  DEFAULT_LEARNING_SETTINGS,
  LEARNING_SETTINGS_KEY,
  decisionInputSchema,
  experimentInputSchema,
  learningSettingsSchema,
  resultInputSchema,
  type DecisionInput,
  type ExperimentInput,
  type LearningSettings,
  type ResultInput,
} from "./types";
import type { DecisionRecord, ExperimentRecord, MemoryStore, ResultRecord } from "./store";

export class MemoryForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryForbiddenError";
  }
}

export class MemoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryValidationError";
  }
}

export interface MemoryServiceDeps {
  store: MemoryStore;
  audit: AuditSink;
  now: () => Date;
  newId: () => string;
}

function label(actor: Actor): string {
  if (actor.kind === "owner") return `owner:${actor.id}`;
  if (actor.kind === "agent") return `agent:${actor.agent}`;
  return "system";
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new MemoryValidationError(parsed.error.issues[0]?.message ?? "Input is invalid.");
  return parsed.data;
}

function noPersonalData(value: unknown, what: string) {
  try {
    assertNoPersonalData(value);
  } catch (error) {
    if (error instanceof PersonalDataError) throw new MemoryValidationError(`${what} contains personal data and was refused.`);
    throw error;
  }
}

/**
 * Business memory. The owner records decisions. Each change to a decision is a new version that points to
 * the one it replaces, so the history of a strategy stays readable. Experiments and results are recorded
 * by the owner or the platform, and every result carries its sample.
 */
export class MemoryService {
  constructor(private readonly deps: MemoryServiceDeps) {}

  private async audit(actor: Actor, type: string, entityType: string, entityId: string, meta: Record<string, unknown>) {
    await this.deps.audit.write({ id: this.deps.newId(), ts: this.deps.now().toISOString(), actor: label(actor), type, entityType, entityId, meta });
  }

  // ----- decisions -----

  async recordDecision(actor: Actor, input: DecisionInput): Promise<DecisionRecord> {
    if (actor.kind !== "owner") throw new MemoryForbiddenError("Only the owner records decisions.");
    const v = parse(decisionInputSchema, input);
    noPersonalData(v.reasoning, "The reasoning");
    const latest = await this.deps.store.latestDecision(v.subjectType, v.subjectRef);
    const record = await this.deps.store.insertDecision({
      subjectType: v.subjectType,
      subjectRef: v.subjectRef,
      decision: v.decision,
      reasoning: v.reasoning,
      version: (latest?.version ?? 0) + 1,
      supersedesId: latest?.id ?? null,
      decidedBy: actor.id,
      decidedAt: this.deps.now().toISOString(),
    });
    await this.audit(actor, "decision.recorded", "decision", record.id, { subjectType: v.subjectType, decision: v.decision, version: record.version });
    return record;
  }

  /** Full version history of one decision subject. Owner and platform only. */
  async decisionHistory(actor: Actor, subjectType: string, subjectRef: string): Promise<DecisionRecord[]> {
    if (actor.kind === "agent") throw new MemoryForbiddenError("Agents cannot read owner decisions.");
    return this.deps.store.decisionHistory(subjectType, subjectRef);
  }

  /** Strategies the owner rejected, with their latest decision. */
  async rejectedStrategies(actor: Actor): Promise<DecisionRecord[]> {
    if (actor.kind === "agent") throw new MemoryForbiddenError("Agents cannot read owner decisions.");
    return (await this.deps.store.latestDecisionsBySubject("strategy")).filter((d) => d.decision === "rejected");
  }

  /**
   * The owner memory an agent run receives. Built by the platform for one run: agents never call this.
   * Refused for agents, so an agent cannot ask for the owner's decisions directly.
   */
  async briefing(actor: Actor): Promise<BriefingItem[]> {
    if (actor.kind === "agent") throw new MemoryForbiddenError("Agents cannot read owner memory directly.");
    const [decisions, experiments, results, settings] = await Promise.all([
      this.deps.store.latestDecisionsBySubject(),
      this.deps.store.listExperiments(),
      this.deps.store.listResults(),
      this.learningSettings(actor),
    ]);
    return buildBriefing({ decisions, experiments, results, settings, now: this.deps.now() });
  }

  // ----- experiments -----

  async createExperiment(actor: Actor, input: ExperimentInput): Promise<ExperimentRecord> {
    if (actor.kind === "agent") throw new MemoryForbiddenError("Agents cannot create experiments.");
    const v = parse(experimentInputSchema, input);
    noPersonalData(v.hypothesis, "The hypothesis");
    const record = await this.deps.store.insertExperiment({ kind: v.kind, name: v.name, hypothesis: v.hypothesis, createdBy: label(actor) });
    await this.audit(actor, "experiment.created", "experiment", record.id, { kind: v.kind });
    return record;
  }

  /** draft to running to finished. Anything else is refused. */
  async setExperimentStatus(actor: Actor, id: string, status: "running" | "finished"): Promise<ExperimentRecord> {
    if (actor.kind === "agent") throw new MemoryForbiddenError("Agents cannot change experiments.");
    const current = await this.deps.store.getExperiment(id);
    if (!current) throw new MemoryValidationError("Experiment not found.");
    const allowed: Record<string, string[]> = { draft: ["running"], running: ["finished"], finished: [] };
    if (!allowed[current.status].includes(status)) throw new MemoryValidationError(`An experiment cannot move from ${current.status} to ${status}.`);
    const updated = await this.deps.store.updateExperimentStatus(id, status, this.deps.now().toISOString());
    await this.audit(actor, "experiment.status", "experiment", id, { status });
    return updated;
  }

  /** The thresholds in force. Falls back to the defaults until the owner sets them. */
  async learningSettings(actor: Actor): Promise<LearningSettings> {
    if (actor.kind === "agent") throw new MemoryForbiddenError("Agents cannot read the learning thresholds.");
    const stored = await this.deps.store.getSetting(LEARNING_SETTINGS_KEY);
    if (stored === null) return DEFAULT_LEARNING_SETTINGS;
    const parsed = learningSettingsSchema.safeParse(stored);
    return parsed.success ? parsed.data : DEFAULT_LEARNING_SETTINGS;
  }

  /** Owner only. Bounds are checked here, so an out-of-range value never reaches the learning calculations. */
  async setLearningSettings(actor: Actor, input: LearningSettings): Promise<LearningSettings> {
    if (actor.kind !== "owner") throw new MemoryForbiddenError("Only the owner changes the learning thresholds.");
    const v = parse(learningSettingsSchema, input);
    await this.deps.store.setSetting(LEARNING_SETTINGS_KEY, v, this.deps.now().toISOString());
    await this.audit(actor, "learning.settings", "settings", LEARNING_SETTINGS_KEY, { minSample: v.minSample, minLift: v.minLift });
    return v;
  }

  async recordResult(actor: Actor, experimentId: string, input: ResultInput): Promise<ResultRecord> {
    if (actor.kind === "agent") throw new MemoryForbiddenError("Agents cannot record results.");
    const v = parse(resultInputSchema, input);
    const experiment = await this.deps.store.getExperiment(experimentId);
    if (!experiment) throw new MemoryValidationError("Experiment not found.");
    if (experiment.status === "draft") throw new MemoryValidationError("Results need a running or finished experiment.");
    const record = await this.deps.store.insertResult({
      experimentId,
      variant: v.variant,
      metric: v.metric,
      value: v.value,
      sampleSize: v.sampleSize,
      source: v.source,
      period: v.period,
      recordedBy: label(actor),
      recordedAt: this.deps.now().toISOString(),
    });
    await this.audit(actor, "experiment.result", "experiment", experimentId, { metric: v.metric, variant: v.variant, sampleSize: v.sampleSize });
    return record;
  }
}
