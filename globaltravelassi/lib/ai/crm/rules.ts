import { z } from "zod";

/**
 * Pure CRM rules: pipeline stages and moves, input validation, explainable lead scoring, purchase-intent
 * detection, follow-up suggestions and the sales funnel. No I/O, no model calls.
 *
 * Scores and intent are rule-based and deterministic. Each point is tied to a named reason code, so the owner can
 * see why a lead scored what it did. Nothing here is an estimate presented as a measurement.
 */

export const LEAD_STAGES = ["new", "contacted", "qualified", "interested", "converted", "lost"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

/** Allowed stage moves. `converted` is terminal. `lost` can be reopened to `new` by the owner. */
const MOVES: Record<LeadStage, LeadStage[]> = {
  new: ["contacted", "lost"],
  contacted: ["qualified", "interested", "lost"],
  qualified: ["interested", "converted", "lost"],
  interested: ["qualified", "converted", "lost"],
  converted: [],
  lost: ["new"],
};

export function canMoveStage(from: LeadStage, to: LeadStage): boolean {
  return from !== to && MOVES[from].includes(to);
}

/**
 * Exceptional moves go backwards or reopen a lead. They are allowed only after the owner approves them. Every other
 * allowed move is standard and needs no further approval. Anything not in MOVES is forbidden.
 */
const EXCEPTIONAL: ReadonlySet<string> = new Set(["qualified>interested", "interested>qualified", "lost>new"]);

export type TransitionKind = "standard" | "exceptional" | "forbidden";

export function transitionKind(from: LeadStage, to: LeadStage): TransitionKind {
  if (!canMoveStage(from, to)) return "forbidden";
  return EXCEPTIONAL.has(`${from}>${to}`) ? "exceptional" : "standard";
}

export function isTerminal(stage: LeadStage): boolean {
  return stage === "converted" || stage === "lost";
}

export const LEAD_SOURCES = ["application", "manual", "campaign", "referral", "social"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const INTERESTS = ["visa", "travel_booking", "document_help", "other"] as const;
export type Interest = (typeof INTERESTS)[number];

export const INTERACTION_KINDS = ["note", "call", "meeting", "message_sent_by_owner", "status_update"] as const;
export type InteractionKind = (typeof INTERACTION_KINDS)[number];

export const FOLLOW_UP_PRIORITIES = ["high", "normal", "low"] as const;
export type FollowUpPriority = (typeof FOLLOW_UP_PRIORITIES)[number];

export const FOLLOW_UP_STATUSES = ["suggested", "scheduled", "done", "dismissed"] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export const INTENT_LEVELS = ["high", "medium", "none"] as const;
export type IntentLevel = (typeof INTENT_LEVELS)[number];

export const MAX_STAGE_REASON = 300;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date in the form YYYY-MM-DD.");
const countryCode = z.string().regex(/^[A-Z]{2}$/, "Use a two-letter country code.");

export const leadInputSchema = z
  .object({
    label: z.string().trim().min(2).max(120),
    source: z.enum(LEAD_SOURCES),
    applicationId: z.string().uuid().nullable(),
    destinationCountry: countryCode.nullable(),
    nationality: countryCode.nullable(),
    travelDate: isoDate.nullable(),
    interest: z.enum(INTERESTS),
  })
  .superRefine((v, ctx) => {
    // A lead that came from an application is tied to that record. Other leads are not.
    if (v.source === "application" && !v.applicationId) ctx.addIssue({ code: "custom", path: ["applicationId"], message: "Choose the application this lead came from." });
    if (v.source !== "application" && v.applicationId) ctx.addIssue({ code: "custom", path: ["applicationId"], message: "Only application leads link to an application." });
  });
export type LeadInput = z.infer<typeof leadInputSchema>;

export const stageChangeSchema = z
  .object({
    to: z.enum(LEAD_STAGES),
    reason: z.string().trim().max(MAX_STAGE_REASON).nullable(),
    /** The lead version the caller read. A change against an older version is refused. */
    expectedVersion: z.number().int().min(1),
  })
  .superRefine((v, ctx) => {
    if (v.to === "lost" && (!v.reason || v.reason.length < 3)) ctx.addIssue({ code: "custom", path: ["reason"], message: "Write why the lead is lost." });
  });
export type StageChange = z.infer<typeof stageChangeSchema>;

export const interactionSchema = z.object({
  kind: z.enum(INTERACTION_KINDS),
  summary: z.string().trim().min(3).max(1000),
});
export type InteractionInput = z.infer<typeof interactionSchema>;

/** Purchase-intent phrases in English, French and Arabic. Matching is by lowercase substring. */
const HIGH_INTENT = ["how much", "price", "cost", "book", "pay", "urgent", "asap", "ready to", "combien", "prix", "réserver", "payer", "prêt", "سعر", "ثمن", "حجز", "عاجل", "بسرعة", "ادفع"];
const MEDIUM_INTENT = ["information", "details", "question", "interested", "renseignement", "intéressé", "معلومات", "تفاصيل", "مهتم"];

/** Detects purchase intent in the owner's own notes. Returns a level only, never the matched text. */
export function detectIntent(texts: string[]): IntentLevel {
  let level: IntentLevel = "none";
  for (const raw of texts) {
    const t = raw.toLowerCase();
    if (HIGH_INTENT.some((p) => t.includes(p))) return "high";
    if (MEDIUM_INTENT.some((p) => t.includes(p))) level = "medium";
  }
  return level;
}

export interface ScoreReason {
  code: string;
  points: number;
}

export interface LeadFacts {
  stage: LeadStage;
  source: LeadSource;
  destinationCountry: string | null;
  travelDate: string | null;
  createdAt: string;
  /** Most recent interaction, or null when none has been recorded. */
  lastActivityAt: string | null;
  interactionSummaries: string[];
}

export interface LeadAssessment {
  score: number;
  reasons: ScoreReason[];
  intent: IntentLevel;
  idleDays: number;
  dormant: boolean;
}

const DAY_MS = 86_400_000;
export const DORMANT_DAYS = 30;
export const TRAVEL_SOON_DAYS = 90;

/** Scores a lead from its stored facts. Every point is named by a reason code. */
export function assessLead(f: LeadFacts, nowIso: string): LeadAssessment {
  const now = Date.parse(nowIso);
  const since = Date.parse(f.lastActivityAt ?? f.createdAt);
  const idleDays = Math.max(0, Math.floor((now - since) / DAY_MS));
  const intent = detectIntent(f.interactionSummaries);
  const dormant = !isTerminal(f.stage) && idleDays >= DORMANT_DAYS;

  if (f.stage === "lost") return { score: 0, reasons: [{ code: "stage_lost", points: 0 }], intent, idleDays, dormant: false };
  if (f.stage === "converted") return { score: 100, reasons: [{ code: "stage_converted", points: 0 }], intent, idleDays, dormant: false };

  const reasons: ScoreReason[] = [];
  const add = (code: string, points: number) => reasons.push({ code, points });

  if (f.source === "application") add("source_application", 30);
  else if (f.source === "referral") add("source_referral", 20);
  else if (f.source === "campaign" || f.source === "social") add("source_campaign", 10);

  if (f.destinationCountry) add("destination_known", 10);

  if (f.travelDate) {
    const days = (Date.parse(f.travelDate) - now) / DAY_MS;
    if (days >= 0 && days <= TRAVEL_SOON_DAYS) add("travel_within_90_days", 15);
  }

  if (f.stage === "contacted") add("stage_contacted", 5);
  if (f.stage === "qualified") add("stage_qualified", 15);
  if (f.stage === "interested") add("stage_interested", 25);

  if (intent === "high") add("intent_high", 20);
  else if (intent === "medium") add("intent_medium", 10);

  if (idleDays <= 7) add("recent_activity", 10);
  if (dormant) add("dormant", -15);

  const score = Math.min(100, Math.max(0, reasons.reduce((sum, r) => sum + r.points, 0)));
  return { score, reasons, intent, idleDays, dormant };
}

export function priorityFor(score: number, intent: IntentLevel): FollowUpPriority {
  if (score >= 70 || intent === "high") return "high";
  if (score >= 40) return "normal";
  return "low";
}

/** Days without activity after which a lead in each stage needs a follow-up. */
const IDLE_THRESHOLD_DAYS: Record<LeadStage, number> = { new: 2, contacted: 4, qualified: 3, interested: 2, converted: Infinity, lost: Infinity };

export interface FollowUpSuggestion {
  reason: string;
  priority: FollowUpPriority;
}

/** Suggests one follow-up for a lead that has gone quiet. Null when no follow-up is due. Never sends anything. */
export function suggestFollowUp(f: LeadFacts, a: LeadAssessment): FollowUpSuggestion | null {
  if (isTerminal(f.stage)) return null;
  if (a.dormant) return { reason: "dormant_30_days", priority: "low" };
  if (a.idleDays >= IDLE_THRESHOLD_DAYS[f.stage]) return { reason: `idle_threshold_${f.stage}`, priority: priorityFor(a.score, a.intent) };
  return null;
}

/** Sales funnel: how many leads have ever reached each stage. A lead counts for every stage it passed through. */
export interface FunnelLead {
  stage: LeadStage;
  /** Every stage the lead has been moved to (its history), excluding the creation stage. */
  reached: LeadStage[];
}

export interface FunnelRow {
  stage: LeadStage;
  reached: number;
  /** Percent of all leads that reached this stage. Null when there are no leads. */
  rate: number | null;
}

export function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;
}

export function salesFunnel(leads: FunnelLead[]): { rows: FunnelRow[]; conversionRate: number | null; lostCount: number; activeCount: number } {
  const total = leads.length;
  const rows = LEAD_STAGES.map((stage) => {
    const reached = leads.filter((l) => stage === "new" || l.stage === stage || l.reached.includes(stage)).length;
    return { stage, reached, rate: rate(reached, total) };
  });
  const converted = leads.filter((l) => l.stage === "converted" || l.reached.includes("converted")).length;
  return {
    rows,
    conversionRate: rate(converted, total),
    lostCount: leads.filter((l) => l.stage === "lost").length,
    activeCount: leads.filter((l) => !isTerminal(l.stage)).length,
  };
}
