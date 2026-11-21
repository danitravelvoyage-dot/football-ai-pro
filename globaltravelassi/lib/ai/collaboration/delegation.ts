import { AGENT_KEYS, type AgentKey } from "../types";

/**
 * Capability-based routing. Pure: no I/O.
 *
 * A task asks for a capability, not an agent. Among the agents that have it and are available, the one with the
 * fewest open tasks wins; ties go to the agent listed first in AGENT_KEYS, so the choice is repeatable.
 * Reassignment (moving a failed task to another agent) is allowed only for read-only capabilities. Any capability that
 * can change something outside the platform is never reassigned: it stays with the agent the owner approved.
 */

export const CAPABILITIES = [
  "market_research",
  "strategy",
  "content_drafting",
  "creative_direction",
  "video_scripts",
  "social_publishing_pack",
  "seo",
  "sales_qualification",
  "crm_hygiene",
  "customer_support",
  "visa_research",
  "analytics",
  "finance_review",
  "compliance_review",
  "website_operations",
  "payments",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** Which agents can perform each capability. The owner's agent registry remains the authority for tools and prompts. */
export const AGENT_CAPABILITIES: Record<AgentKey, readonly Capability[]> = {
  COOAgent: [],
  MarketResearchAgent: ["market_research"],
  MarketingStrategistAgent: ["strategy", "market_research"],
  ContentCreatorAgent: ["content_drafting", "seo"],
  CreativeDirectorAgent: ["creative_direction"],
  VideoProductionAgent: ["video_scripts"],
  SocialMediaAgent: ["social_publishing_pack", "content_drafting"],
  SEOAgent: ["seo"],
  SalesAgent: ["sales_qualification"],
  CustomerSupportAgent: ["customer_support"],
  CRMAgent: ["crm_hygiene", "sales_qualification"],
  VisaResearchAgent: ["visa_research"],
  DataAnalystAgent: ["analytics"],
  FinanceAgent: ["finance_review"],
  ComplianceAgent: ["compliance_review"],
  WebsiteOperationsAgent: ["website_operations"],
};

/**
 * Capabilities that can change something outside the platform or touch money or customers. Their assignments are
 * protected: a step with one of these is never routed, and a failed task with one is never reassigned.
 */
export const PROTECTED_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>(["social_publishing_pack", "customer_support", "website_operations", "payments"]);

/**
 * Steps that may be routed, keyed by "workflow.step". Every other step keeps its template agent: approvals, customer
 * messages, publishing, deterministic steps and compliance reviews (which must stay with the compliance agent).
 */
export const ROUTABLE_STEPS: Readonly<Record<string, Capability>> = {
  "marketing.research": "market_research",
  "marketing.strategy": "strategy",
  "marketing.campaign": "content_drafting",
  "marketing.scripts": "video_scripts",
  "marketing.creative_brief": "creative_direction",
  "sales.lead": "crm_hygiene",
  "sales.qualification": "sales_qualification",
  "sales.service_recommendation": "sales_qualification",
  "support.knowledge_retrieval": "visa_research",
  "visa.source_discovery": "visa_research",
  "visa.extraction": "visa_research",
  "analytics.analysis": "analytics",
  "analytics.insights": "analytics",
  "analytics.recommendations": "analytics",
};

export function routingCapabilityFor(workflowKey: string, stepKey: string, approval: boolean, deterministic: boolean): Capability | null {
  if (approval || deterministic) return null;
  const capability = ROUTABLE_STEPS[`${workflowKey}.${stepKey}`];
  if (!capability || PROTECTED_CAPABILITIES.has(capability)) return null;
  return capability;
}

export function canReassign(capability: Capability): boolean {
  return !PROTECTED_CAPABILITIES.has(capability);
}

export interface Candidate {
  agent: AgentKey;
  openTasks: number;
  available: boolean;
}

export interface RouteOptions {
  exclude?: AgentKey[];
  reassignment?: boolean;
  /** The template's agent. Wins a tie on workload, so routing keeps the template's choice when nothing is busier. */
  preferred?: AgentKey;
}

export type RouteResult = { agent: AgentKey; reasons: string[] } | { refused: "no_capable_agent" | "reassignment_not_allowed" };

export function routeTask(capability: Capability, candidates: Candidate[], options: RouteOptions = {}): RouteResult {
  if (options.reassignment && !canReassign(capability)) return { refused: "reassignment_not_allowed" };
  const exclude = new Set(options.exclude ?? []);
  const eligible = candidates
    .filter((c) => c.available && !exclude.has(c.agent) && AGENT_CAPABILITIES[c.agent].includes(capability))
    .sort(
      (a, b) =>
        a.openTasks - b.openTasks ||
        (a.agent === options.preferred ? 0 : 1) - (b.agent === options.preferred ? 0 : 1) ||
        AGENT_KEYS.indexOf(a.agent) - AGENT_KEYS.indexOf(b.agent),
    );
  const best = eligible[0];
  if (!best) return { refused: "no_capable_agent" };
  return { agent: best.agent, reasons: ["capability_match", options.reassignment ? "reassigned" : "initial_assignment", "lowest_open_workload"] };
}
