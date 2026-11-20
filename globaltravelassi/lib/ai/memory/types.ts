import { z } from "zod";

export const SUBJECT_TYPES = ["approval", "strategy", "campaign", "pricing", "service", "other"] as const;
export const DECISIONS = ["approved", "rejected", "changed", "retired"] as const;
export const EXPERIMENT_KINDS = ["campaign", "content", "sales"] as const;
export const METRICS = ["impressions", "clicks", "leads", "applications", "conversions", "revenue", "reply_rate"] as const;
export const RESULT_SOURCES = ["aggregate", "manual", "import"] as const;
export const COUNT_METRICS = ["impressions", "clicks", "leads", "applications", "conversions"] as const;

/** Defaults. The owner can change them; the values in force are stored in ai_settings under "learning". */
export const MIN_EVIDENCE_SAMPLE = 30;
export const MIN_RELATIVE_LIFT = 0.2;
export const LEARNING_SETTINGS_KEY = "learning";

export interface LearningSettings {
  /** Minimum sample before a comparison counts as evidence. */
  minSample: number;
  /** Relative lift between two variants needed to call a winner, as a fraction (0.2 = 20 percent). */
  minLift: number;
}

export const DEFAULT_LEARNING_SETTINGS: LearningSettings = { minSample: MIN_EVIDENCE_SAMPLE, minLift: MIN_RELATIVE_LIFT };

export const learningSettingsSchema = z.object({
  minSample: z.number().int().min(5).max(100_000),
  minLift: z.number().min(0.01).max(5),
});
/** Days after which an approved strategy with no newer decision is considered outdated. */
export const OUTDATED_AFTER_DAYS = 90;

export const decisionInputSchema = z.object({
  subjectType: z.enum(SUBJECT_TYPES),
  subjectRef: z.string().min(1).max(120),
  decision: z.enum(DECISIONS),
  reasoning: z.string().min(1).max(1000),
});
export type DecisionInput = z.infer<typeof decisionInputSchema>;

export const experimentInputSchema = z.object({
  kind: z.enum(EXPERIMENT_KINDS),
  name: z.string().min(2).max(120),
  hypothesis: z.string().min(5).max(500),
});
export type ExperimentInput = z.infer<typeof experimentInputSchema>;

export const resultInputSchema = z
  .object({
    variant: z.string().min(1).max(60),
    metric: z.enum(METRICS),
    value: z.number().finite().min(0),
    sampleSize: z.number().int().min(1),
    source: z.enum(["aggregate", "manual", "import"]),
    period: z.string().min(2).max(40),
  })
  .superRefine((r, ctx) => {
    if ((COUNT_METRICS as readonly string[]).includes(r.metric) && !Number.isInteger(r.value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "This metric is a whole count." });
    }
    if (r.metric === "reply_rate" && r.value > 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "A reply rate cannot exceed 1." });
    }
  });
export type ResultInput = z.infer<typeof resultInputSchema>;
