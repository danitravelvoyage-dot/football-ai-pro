import type { ActionClass, AgentKey } from "../types";

export type WorkflowKey = "marketing" | "sales" | "support" | "visa" | "analytics";

export type DeterministicStep = "analytics.aggregate" | "visa.validate";

export interface WorkflowStep {
  key: string;
  agent: AgentKey;
  title: string;
  dependsOn: string[];
  priority: number;
  dueInHours: number | null;
  /** When set, the owner must approve before the step counts as done. */
  approval: { actionClass: ActionClass; riskLevel: "low" | "medium" | "high" } | null;
  /** When set, the step runs deterministic code instead of a model. */
  deterministic: DeterministicStep | null;
}

export interface WorkflowTemplate {
  key: WorkflowKey;
  title: string;
  steps: WorkflowStep[];
}

function step(
  key: string,
  agent: AgentKey,
  title: string,
  dependsOn: string[],
  extra: Partial<Pick<WorkflowStep, "approval" | "deterministic" | "priority" | "dueInHours">> = {},
): WorkflowStep {
  return {
    key,
    agent,
    title,
    dependsOn,
    priority: extra.priority ?? 5,
    dueInHours: extra.dueInHours ?? null,
    approval: extra.approval ?? null,
    deterministic: extra.deterministic ?? null,
  };
}

/** Research → Strategy → Campaign → Scripts → Creative Brief → Compliance → Approval */
const MARKETING: WorkflowTemplate = {
  key: "marketing",
  title: "Marketing campaign",
  steps: [
    step("research", "MarketResearchAgent", "Market research", []),
    step("strategy", "MarketingStrategistAgent", "Strategy", ["research"]),
    step("campaign", "ContentCreatorAgent", "Campaign drafts", ["strategy"]),
    step("scripts", "VideoProductionAgent", "Scripts", ["campaign"]),
    step("creative_brief", "CreativeDirectorAgent", "Creative brief", ["campaign"]),
    step("compliance", "ComplianceAgent", "Compliance review", ["campaign", "scripts", "creative_brief"], { priority: 8 }),
    step("approval", "SocialMediaAgent", "Publishing pack (owner approval)", ["compliance"], {
      priority: 9,
      approval: { actionClass: "external_publish", riskLevel: "medium" },
    }),
  ],
};

/** Lead → Qualification → Service Recommendation → Response Draft → Approval → Follow-up */
const SALES: WorkflowTemplate = {
  key: "sales",
  title: "Sales follow-up",
  steps: [
    step("lead", "CRMAgent", "Lead hygiene proposal", [], { priority: 6 }),
    step("qualification", "SalesAgent", "Qualification", ["lead"]),
    step("service_recommendation", "SalesAgent", "Service recommendation", ["qualification"]),
    step("response_draft", "SalesAgent", "Response draft", ["service_recommendation"]),
    step("compliance", "ComplianceAgent", "Compliance review", ["response_draft"], { priority: 8 }),
    step("approval", "SalesAgent", "Customer message (owner approval)", ["compliance"], {
      priority: 9,
      approval: { actionClass: "external_send_message", riskLevel: "medium" },
    }),
    step("follow_up", "SalesAgent", "Follow-up plan", ["approval"], { dueInHours: 48 }),
  ],
};

/** Inquiry → Classification → Knowledge Retrieval → Draft Response → Approval */
const SUPPORT: WorkflowTemplate = {
  key: "support",
  title: "Customer support reply",
  steps: [
    step("inquiry", "CustomerSupportAgent", "Inquiry intake", [], { priority: 7 }),
    step("classification", "CustomerSupportAgent", "Classification", ["inquiry"]),
    step("knowledge_retrieval", "VisaResearchAgent", "Knowledge retrieval", ["classification"]),
    step("draft_response", "CustomerSupportAgent", "Draft response", ["knowledge_retrieval"]),
    step("compliance", "ComplianceAgent", "Compliance review", ["draft_response"], { priority: 8 }),
    step("approval", "CustomerSupportAgent", "Customer reply (owner approval)", ["compliance"], {
      priority: 9,
      approval: { actionClass: "external_send_message", riskLevel: "low" },
    }),
  ],
};

/** Official Source Discovery → Information Extraction → Source Validation → Date Verification → Structured Report */
const VISA: WorkflowTemplate = {
  key: "visa",
  title: "Visa intelligence",
  steps: [
    step("source_discovery", "VisaResearchAgent", "Official source discovery", []),
    step("extraction", "VisaResearchAgent", "Information extraction", ["source_discovery"]),
    step("source_validation", "VisaResearchAgent", "Source and date validation", ["extraction"], {
      deterministic: "visa.validate",
      priority: 8,
    }),
    step("structured_report", "ComplianceAgent", "Structured report", ["source_validation"], { priority: 7 }),
  ],
};

/** Data Aggregation → Performance Analysis → Insights → Recommendations → Executive Report */
const ANALYTICS: WorkflowTemplate = {
  key: "analytics",
  title: "Performance analysis",
  steps: [
    step("aggregation", "DataAnalystAgent", "Data aggregation", [], { deterministic: "analytics.aggregate" }),
    step("analysis", "DataAnalystAgent", "Performance analysis", ["aggregation"]),
    step("insights", "DataAnalystAgent", "Insights", ["analysis"]),
    step("recommendations", "DataAnalystAgent", "Recommendations", ["insights"]),
    step("executive_report", "COOAgent", "Executive report", ["recommendations"], { priority: 8 }),
  ],
};

export const WORKFLOW_TEMPLATES: Record<WorkflowKey, WorkflowTemplate> = {
  marketing: MARKETING,
  sales: SALES,
  support: SUPPORT,
  visa: VISA,
  analytics: ANALYTICS,
};

export function getWorkflow(key: WorkflowKey): WorkflowTemplate {
  return WORKFLOW_TEMPLATES[key];
}
