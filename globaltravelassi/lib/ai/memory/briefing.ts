import { hypothesesFrom, outdatedStrategies, repeatedPatterns, type Recommendation } from "./learning";
import type { LearningSettings } from "./types";
import type { DecisionRecord, ExperimentRecord, ResultRecord } from "./store";
import { METRICS } from "./types";

/**
 * Owner memory, prepared for agents. Pure: no I/O. The platform builds this briefing and attaches it to an
 * agent's input. Agents never query the memory store themselves.
 *
 * What an agent receives: rejected and outdated strategies, and learning that cites evidence.
 * What it never receives: decision versions, the owner's identity, or results below the minimum sample.
 */
export const BRIEFING_SCOPE = "company";
export const BRIEFING_DECISIONS_KEY = "owner.decisions";
export const BRIEFING_LEARNING_KEY = "learning.evidence";
export const MAX_BRIEFING_ITEMS = 10;

export interface BriefingItem {
  scope: string;
  key: string;
  value: unknown;
}

export interface BriefingSource {
  /** Latest decision per subject. */
  decisions: DecisionRecord[];
  experiments: ExperimentRecord[];
  results: ResultRecord[];
  settings: LearningSettings;
  now: Date;
}

export interface DecisionBrief {
  subject: string;
  decision: DecisionRecord["decision"];
  reasoning: string;
  decidedAt: string;
}

export interface LearningBrief {
  metric: string;
  statement: string;
  evidence: { experimentId: string; metric: string; variant: string; sampleSize: number }[];
}

/** Rejected or retired strategies, plus strategies the owner has not reviewed for 90 days. Empty lists are omitted. */
export function decisionsBrief(decisions: DecisionRecord[], now: Date): { rejected: DecisionBrief[]; needsReview: DecisionBrief[] } {
  const strategies = decisions.filter((d) => d.subjectType === "strategy");
  const toBrief = (d: DecisionRecord): DecisionBrief => ({
    subject: d.subjectRef,
    decision: d.decision,
    reasoning: d.reasoning,
    decidedAt: d.decidedAt,
  });
  const rejected = strategies
    .filter((d) => d.decision === "rejected" || d.decision === "retired")
    .slice(0, MAX_BRIEFING_ITEMS)
    .map(toBrief);
  const needsReview = outdatedStrategies(strategies, now)
    .filter((d) => d.decision !== "rejected" && d.decision !== "retired")
    .slice(0, MAX_BRIEFING_ITEMS)
    .map(toBrief);
  return { rejected, needsReview };
}

/** Learning that passed the evidence gate, for every metric. Results below the minimum sample never reach this list. */
export function learningBrief(source: Pick<BriefingSource, "experiments" | "results" | "settings">): LearningBrief[] {
  const out: LearningBrief[] = [];
  for (const metric of METRICS) {
    const patterns = repeatedPatterns(source.experiments, source.results, metric, source.settings);
    const recs: Recommendation[] = hypothesesFrom(patterns, source.results, metric, source.settings);
    for (const rec of recs) {
      out.push({
        metric,
        statement: rec.statement,
        evidence: rec.evidence.map((e) => ({ experimentId: e.experimentId, metric: e.metric, variant: e.variant, sampleSize: e.sampleSize })),
      });
    }
  }
  return out.slice(0, MAX_BRIEFING_ITEMS);
}

/** The context items an agent receives. Each list is omitted when it is empty. */
export function buildBriefing(source: BriefingSource): BriefingItem[] {
  const items: BriefingItem[] = [];
  const decisions = decisionsBrief(source.decisions, source.now);
  if (decisions.rejected.length > 0 || decisions.needsReview.length > 0) {
    items.push({ scope: BRIEFING_SCOPE, key: BRIEFING_DECISIONS_KEY, value: decisions });
  }
  const learning = learningBrief(source);
  if (learning.length > 0) {
    items.push({ scope: BRIEFING_SCOPE, key: BRIEFING_LEARNING_KEY, value: { items: learning } });
  }
  return items;
}
