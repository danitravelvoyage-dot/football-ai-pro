import { z } from "zod";
import type { Actor } from "../types";
import type { AuditSink } from "../audit";
import type { AgentRuntime } from "../runtime";
import { getAgent, type AgentDefinition } from "../registry";
import { LEAD_STAGES, type LeadStage } from "../crm/rules";
import type { CrmService } from "../crm/service";
import { validateStage } from "./validate";
import type { ReviewOpenInput } from "../review/service";

/**
 * Answers "what stage is this lead in?" from the stored lead record, which is the source of truth.
 *
 * The CRM agent is also asked, with only the question and the list of allowed stages. Its answer is a cross-check, never
 * the answer:
 *  - agreed:    the model's stage matches the record. The record is the answer.
 *  - refused:   the model named a stage the CRM does not define, or broke the contract. The record is still the answer,
 *               and the refusal is recorded. Nothing the model said is shown to the owner.
 *  - disagreed: the model named a different defined stage. The record is still the answer, and the case is escalated
 *               to the owner, because one of the two is wrong.
 * Owner only. The audit entry holds the lead id, the status and codes, never the question or the lead's details.
 */

export const STAGE_ANSWER_SCHEMA = z.object({ stage: z.enum(LEAD_STAGES), reason: z.string().max(300).default("") });

export interface StageAnswer {
  leadId: string;
  /** The stage as stored. Always the answer. */
  stage: LeadStage;
  source: "crm_record";
  modelCheck: "agreed" | "disagreed" | "refused";
  status: "answered" | "escalated";
  reasons: string[];
}

export interface StageAnswerDeps {
  /** Opens a disagreement for the owner. Optional: without it, the escalation is audited only. */
  review?: { open(input: ReviewOpenInput): Promise<unknown> };
  runtime: AgentRuntime;
  crm: CrmService;
  audit: AuditSink;
  now: () => Date;
  newId: () => string;
}

function stageDefinition(): AgentDefinition {
  const base = getAgent("CRMAgent");
  return {
    ...base,
    outputKind: "crm_stage",
    outputSchema: STAGE_ANSWER_SCHEMA,
    timeoutMs: 30_000,
    prompt: {
      ...base.prompt,
      system: `You are the CRM Agent. Choose the pipeline stage the question asks about, from exactly this list: ${LEAD_STAGES.join(", ")}. Reply with JSON only, in exactly this form: {"stage": "<one name from the list>", "reason": "<one short sentence>"}.`,
    },
    mockOutput: () => ({ stage: "new", reason: "Mock." }),
  };
}

export class StageAnswerService {
  constructor(private readonly deps: StageAnswerDeps) {}

  async answer(actor: Actor, leadId: string, question: string): Promise<StageAnswer> {
    if (actor.kind !== "owner" || actor.id.trim().length === 0) throw new Error("Only the owner can ask for a lead's stage.");
    // Throws if the lead does not exist. The record is read through the owner's CRM service.
    const { lead } = await this.deps.crm.view(actor, leadId);

    const reasons: string[] = [];
    let modelCheck: StageAnswer["modelCheck"];
    try {
      const { output } = await this.deps.runtime.run(stageDefinition(), {
        objective: "Which pipeline stage does the question refer to?",
        language: "en",
        country: "all",
        brief: question,
        data: {},
        aggregates: [],
        upstream: [],
        context: [],
        knowledge: [],
      });
      const suggested = (output as { stage: string }).stage;
      const verdict = validateStage(suggested, { stage: lead.stage });
      if (verdict.status === "verified") {
        modelCheck = "agreed";
      } else {
        modelCheck = "disagreed";
        reasons.push(verdict.issues[0]?.code ?? "disagreed");
      }
    } catch {
      modelCheck = "refused";
      reasons.push("model_output_refused");
    }

    const status: StageAnswer["status"] = modelCheck === "disagreed" ? "escalated" : "answered";
    if (status === "escalated" && this.deps.review) {
      // The record and the model disagree. The owner decides which is right. The question text is not stored.
      await this.deps.review.open({
        kind: "crm_stage_disagreement",
        agent: "CRMAgent",
        runId: null,
        taskId: null,
        leadId,
        subjectRef: leadId,
        summary: "The stored stage and the CRM agent's stage differ. The stored stage is shown as the answer until you decide.",
        evidence: { recordStage: lead.stage, reasons },
        payload: { leadId, recordStage: lead.stage },
      });
    }
    await this.deps.audit.write({
      id: this.deps.newId(),
      ts: this.deps.now().toISOString(),
      actor: `owner:${actor.id}`,
      type: "crm.stage_answered",
      entityType: "crm_lead",
      entityId: leadId,
      meta: { status, modelCheck, reasons },
    });
    return { leadId, stage: lead.stage, source: "crm_record", modelCheck, status, reasons };
  }
}
