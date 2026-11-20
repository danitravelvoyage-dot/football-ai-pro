import { z } from "zod";

/** The sixteen agents. Keys are stable identifiers stored in the database. */
export const AGENT_KEYS = [
  "COOAgent",
  "MarketResearchAgent",
  "MarketingStrategistAgent",
  "ContentCreatorAgent",
  "CreativeDirectorAgent",
  "VideoProductionAgent",
  "SocialMediaAgent",
  "SEOAgent",
  "SalesAgent",
  "CustomerSupportAgent",
  "CRMAgent",
  "VisaResearchAgent",
  "DataAnalystAgent",
  "FinanceAgent",
  "ComplianceAgent",
  "WebsiteOperationsAgent",
] as const;

export const agentKeySchema = z.enum(AGENT_KEYS);
export type AgentKey = z.infer<typeof agentKeySchema>;

export const TASK_STATUSES = [
  "pending",
  "ready",
  "running",
  "waiting_approval",
  "succeeded",
  "failed",
  "blocked",
  "cancelled",
] as const;
export const taskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

/** Every kind of action an agent or the system could take. `external_*` never runs inside this platform. */
export const ACTION_CLASSES = [
  "read_internal",
  "write_draft",
  "propose_change",
  "external_publish",
  "external_send_message",
  "external_payment",
  "external_production_change",
  "external_deploy",
  "external_commitment",
] as const;
export const actionClassSchema = z.enum(ACTION_CLASSES);
export type ActionClass = z.infer<typeof actionClassSchema>;

export function isExternalAction(action: ActionClass): boolean {
  return action.startsWith("external_");
}

export const LANGUAGES = ["ar", "fr", "en"] as const;
export const languageSchema = z.enum(LANGUAGES);
export type Language = z.infer<typeof languageSchema>;

export const COUNTRIES = ["dz", "ma", "tn", "all"] as const;
export const countrySchema = z.enum(COUNTRIES);
export type Country = z.infer<typeof countrySchema>;

/** Who is acting. Only the owner can decide approvals. Agents cannot. */
export type Actor = { kind: "owner"; id: string } | { kind: "agent"; agent: AgentKey } | { kind: "system" };

export const agentInputSchema = z.object({
  objective: z.string().min(3).max(2000),
  language: languageSchema,
  country: countrySchema,
  brief: z.string().max(4000),
  data: z
    .record(z.string().max(60), z.union([z.string().max(500), z.number(), z.boolean(), z.null()]))
    .default({}),
  upstream: z.array(z.unknown()).max(20).default([]),
  /** Aggregate counts only (for example status and count per day). Never row-level records. */
  aggregates: z
    .array(z.record(z.string().max(60), z.union([z.string().max(60), z.number(), z.null()])))
    .max(1000)
    .default([]),
  /** Shared context this agent is allowed to read (see the context access rules). */
  context: z
    .array(z.object({ scope: z.string().max(30), key: z.string().max(80), value: z.unknown() }))
    .max(30)
    .default([]),
  /** Verified, current knowledge-base facts only. Unverified or stale entries never reach an agent. */
  knowledge: z
    .array(
      z.object({
        category: z.string().max(40),
        title: z.string().max(160),
        body: z.string().max(1500),
        reliability: z.string().max(40),
        verifiedAt: z.string().nullable(),
        officialSourceUrl: z.string().max(500).nullable(),
      }),
    )
    .max(10)
    .default([]),
});
export type AgentInput = z.infer<typeof agentInputSchema>;
