import type { AgentKey } from "./types";

/** Departments group the sixteen agents. Used for the department map and the executive view. */
export const DEPARTMENTS: { key: "strategy" | "creative" | "commercial" | "intelligence" | "operations"; agents: AgentKey[] }[] = [
  { key: "strategy", agents: ["COOAgent", "MarketResearchAgent", "MarketingStrategistAgent", "DataAnalystAgent"] },
  { key: "creative", agents: ["ContentCreatorAgent", "CreativeDirectorAgent", "VideoProductionAgent", "SocialMediaAgent", "SEOAgent"] },
  { key: "commercial", agents: ["SalesAgent", "CRMAgent", "CustomerSupportAgent"] },
  { key: "intelligence", agents: ["VisaResearchAgent"] },
  { key: "operations", agents: ["FinanceAgent", "ComplianceAgent", "WebsiteOperationsAgent"] },
];
