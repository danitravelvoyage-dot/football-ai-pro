import { z } from "zod";

export const QUALITY_STATUSES = ["PASSED", "NEEDS_REVISION", "REJECTED", "REQUIRES_HUMAN_REVIEW"] as const;
export type QualityStatus = (typeof QUALITY_STATUSES)[number];

export const DIMENSIONS = ["schema_validity", "factual_support", "completeness", "source_reliability", "policy_compliance"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const SEVERITIES = ["info", "warning", "blocking", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface QualityIssue {
  code: string;
  dimension: Dimension;
  severity: Severity;
  /** Where in the output the problem is. Never the content itself, so no customer text is stored. */
  path: string;
}

/** A factual statement pulled out of an output, with the evidence it cites. */
export interface Claim {
  key: string;
  producer: string;
  category: "general" | "visa" | "finance" | "compliance" | "analytics";
  confidence: "low" | "medium" | "high" | null;
  sourceUrl: string | null;
  checkedAt: string | null;
  /** Whether the producer marked this as checked against an official source. */
  official: boolean;
  path: string;
  value?: unknown;
}

export const scoringWeightsSchema = z
  .object({
    schema_validity: z.number().min(0).max(1),
    factual_support: z.number().min(0).max(1),
    completeness: z.number().min(0).max(1),
    source_reliability: z.number().min(0).max(1),
    policy_compliance: z.number().min(0).max(1),
  })
  .refine((w) => Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1) < 1e-9, { message: "Weights must add up to 1." });
export type ScoringWeights = z.infer<typeof scoringWeightsSchema>;

export const DEFAULT_WEIGHTS: ScoringWeights = {
  schema_validity: 0.3,
  factual_support: 0.25,
  completeness: 0.2,
  source_reliability: 0.15,
  policy_compliance: 0.1,
};

export interface QualityConfig {
  weights: ScoringWeights;
  /** Overall score needed to pass with no blocking issue. */
  passScore: number;
  /** Revisions allowed after the first attempt. The attempt that exceeds this is rejected. */
  maxAttempts: number;
  /** Source age beyond which a source counts as stale. */
  maxSourceAgeDays: number;
}

export const DEFAULT_QUALITY_CONFIG: QualityConfig = {
  weights: DEFAULT_WEIGHTS,
  passScore: 70,
  maxAttempts: 2,
  maxSourceAgeDays: 90,
};

export interface RevisionFeedback {
  code: string;
  path: string;
  instruction: string;
}

export interface QualityReview {
  status: QualityStatus;
  attempt: number;
  overall: number;
  scores: Record<Dimension, number>;
  issues: QualityIssue[];
  feedback: RevisionFeedback[];
}
