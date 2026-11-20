import { z } from "zod";
import type { ToolName } from "./tools";
import { AGENT_KEYS, type AgentInput, type AgentKey } from "./types";

/** Output contracts. Every agent output is validated against one of these before it is stored. */
const finding = z.object({
  insight: z.string().min(1).max(600),
  evidence: z.string().max(600),
  confidence: z.enum(["low", "medium", "high"]),
  sources: z.array(z.string().url()).max(10),
});

const requirement = z.object({
  destination: z.string().min(2).max(60),
  item: z.string().min(2).max(300),
  source_url: z.string().url(),
  last_checked: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  verified_by_official_source: z.boolean(),
});

export const outputSchemas = {
  coo: z.object({ summary: z.string().min(1).max(2000), next_steps: z.array(z.string().max(300)).max(10) }),
  research: z.object({ findings: z.array(finding).max(20) }),
  strategy: z.object({
    campaigns: z
      .array(z.object({ name: z.string().max(120), goal: z.string().max(300), channel: z.string().max(60), rationale: z.string().max(600) }))
      .max(10),
  }),
  content: z.object({
    drafts: z.array(z.object({ kind: z.enum(["caption", "post", "landing_copy", "broadcast"]), language: z.enum(["ar", "fr", "en"]), text: z.string().min(1).max(3000) })).max(20),
  }),
  creative: z.object({ visual_direction: z.string().max(800), do: z.array(z.string().max(200)).max(10), dont: z.array(z.string().max(200)).max(10) }),
  video: z.object({
    hook: z.string().max(300),
    scenes: z.array(z.object({ no: z.number().int().min(1), visual: z.string().max(400), voiceover: z.string().max(400) })).max(12),
  }),
  social: z.object({
    calendar: z.array(z.object({ date: z.string().max(20), platform: z.string().max(40), draft_ref: z.string().max(60), notes: z.string().max(300) })).max(60),
  }),
  seo: z.object({
    recommendations: z.array(z.object({ page: z.string().max(200), issue: z.string().max(300), action: z.string().max(300), priority: z.enum(["low", "medium", "high"]) })).max(30),
  }),
  sales: z.object({
    priorities: z.array(z.object({ ref_id: z.string().max(60), urgency: z.enum(["low", "medium", "high"]), reason: z.string().max(300) })).max(50),
    follow_up_drafts: z.array(z.object({ ref_id: z.string().max(60), text: z.string().max(1000) })).max(50),
  }),
  support: z.object({ classification: z.string().max(60), urgent: z.boolean(), draft_reply: z.string().max(2000) }),
  crm: z.object({ proposals: z.array(z.object({ ref_id: z.string().max(60), change: z.string().max(200), reason: z.string().max(300) })).max(100) }),
  visa: z.object({ requirements: z.array(requirement).max(50) }),
  analytics: z.object({
    metrics: z.array(z.object({ name: z.string().max(80), value: z.number(), period: z.string().max(40) })).max(50),
    insights: z.array(z.string().max(400)).max(20),
    recommendations: z.array(z.string().max(400)).max(20),
  }),
  finance: z.object({
    summary: z.array(z.object({ currency: z.string().max(5), received: z.number(), pending: z.number() })).max(10),
    reminder_drafts: z.array(z.string().max(1000)).max(50),
  }),
  compliance: z.object({
    verdict: z.enum(["pass", "fail"]),
    flags: z.array(z.object({ rule: z.string().max(80), excerpt: z.string().max(300), severity: z.enum(["info", "warning", "blocking"]) })).max(50),
  }),
  website: z.object({
    checks: z.array(z.object({ name: z.string().max(80), status: z.enum(["ok", "warn", "fail"]), detail: z.string().max(300) })).max(50),
    patch_proposals: z.array(z.string().max(2000)).max(10),
  }),
} as const;

export type AgentOutputSchemaKey = keyof typeof outputSchemas;

export interface AgentDefinition {
  key: AgentKey;
  name: string;
  mission: string;
  /** Things this agent must never do. Shown in the dashboard and in the system prompt. */
  boundaries: string[];
  tools: ToolName[];
  outputKind: string;
  outputSchema: z.ZodTypeAny;
  prompt: { version: string; system: string };
  timeoutMs: number;
  maxAttempts: number;
  /** Deterministic placeholder used only by the mock provider. Output is labelled as mock. */
  mockOutput: (input: AgentInput) => unknown;
}

const COMMON_BOUNDARIES = [
  "Never send, publish, pay, deploy or change production data.",
  "Never state that an external action was completed.",
  "Never include customer personal data in outputs.",
];

function def(
  key: AgentKey,
  name: string,
  mission: string,
  schemaKey: AgentOutputSchemaKey,
  tools: ToolName[],
  extraBoundaries: string[],
  systemLine: string,
  mockOutput: (input: AgentInput) => unknown,
): AgentDefinition {
  return {
    key,
    name,
    mission,
    boundaries: [...COMMON_BOUNDARIES, ...extraBoundaries],
    tools,
    outputKind: schemaKey,
    outputSchema: outputSchemas[schemaKey],
    prompt: {
      version: "1.0.0",
      system: `You are ${name} inside the GLOBALTRAVELASSI operations team (travel and visa consulting for Algeria, Morocco and Tunisia). ${systemLine} Reply with JSON only, matching the requested schema. Never claim that you executed an action; you only prepare work for the owner. Never guarantee a visa outcome.`,
    },
    timeoutMs: 60_000,
    maxAttempts: 3,
    mockOutput,
  };
}

const CAPTION_NOTE = "Use the owner's brand tone: calm, professional, trustworthy.";

export const AGENT_REGISTRY: Record<AgentKey, AgentDefinition> = {
  COOAgent: def(
    "COOAgent",
    "AI Chief Operating Officer",
    "Coordinates the team: turns owner objectives into a plan, monitors progress and writes executive summaries.",
    "coo",
    ["store.readAggregates", "store.saveArtifact"],
    ["Never approve anything on the owner's behalf.", "Never mark an external action as done."],
    "You summarise progress and propose next steps from the task data you receive.",
    () => ({ summary: "Mock executive summary (mock provider).", next_steps: ["Review pending approvals."] }),
  ),
  MarketResearchAgent: def(
    "MarketResearchAgent",
    "Market Research Agent",
    "Finds demand signals for Algeria, Morocco and Tunisia from information the owner provides.",
    "research",
    ["store.readAggregates", "store.saveArtifact", "store.saveMemory"],
    ["Never scrape pages behind a login.", "Only cite sources that were provided to you."],
    "Produce findings with an explicit confidence level and the sources you were given.",
    () => ({ findings: [{ insight: "Mock finding.", evidence: "Mock evidence.", confidence: "low", sources: [] }] }),
  ),
  MarketingStrategistAgent: def(
    "MarketingStrategistAgent",
    "Marketing Strategist",
    "Turns research and KPIs into organic, country-specific campaign plans.",
    "strategy",
    ["store.readAggregates", "store.saveArtifact", "store.saveMemory"],
    ["Never commit a budget.", "Never promise results."],
    "Propose campaigns with goal, channel and rationale. Organic channels first.",
    () => ({ campaigns: [{ name: "Mock campaign", goal: "Mock goal", channel: "organic", rationale: "Mock rationale." }] }),
  ),
  ContentCreatorAgent: def(
    "ContentCreatorAgent",
    "Content Creator",
    "Drafts captions, posts, landing copy and broadcast texts in Arabic (Darija or MSA), French and English.",
    "content",
    ["store.readKnowledge", "store.saveArtifact"],
    ["Never publish or send.", "Never invent testimonials, numbers or availability dates."],
    `${CAPTION_NOTE} Mark Darija text clearly so a native reviewer can check it.`,
    (input) => ({ drafts: [{ kind: "caption", language: input.language, text: "Mock draft. Review before use." }] }),
  ),
  CreativeDirectorAgent: def(
    "CreativeDirectorAgent",
    "Creative Director",
    "Keeps visuals on brand (midnight navy, champagne gold, white, soft grey) and culturally appropriate.",
    "creative",
    ["store.readKnowledge", "store.saveArtifact"],
    ["Never generate images or video.", "Never use real people's likeness without written consent."],
    "Write a visual direction with do and don't lists.",
    () => ({ visual_direction: "Mock visual direction.", do: ["Keep palette consistent."], dont: ["Avoid clutter."] }),
  ),
  VideoProductionAgent: def(
    "VideoProductionAgent",
    "Video Production",
    "Writes scripts, scene plans and voiceover text. Assembly uses only media the owner uploads.",
    "video",
    ["store.readKnowledge", "store.saveArtifact"],
    ["Never generate AI video or voices of real people.", "Never publish."],
    "Write a short hook and numbered scenes, each with visual and voiceover.",
    () => ({ hook: "Mock hook.", scenes: [{ no: 1, visual: "Mock visual.", voiceover: "Mock voiceover." }] }),
  ),
  SocialMediaAgent: def(
    "SocialMediaAgent",
    "Social Media Manager",
    "Builds a content calendar and prepares manual publishing packs.",
    "social",
    ["store.saveArtifact", "approval.propose"],
    ["Never publish.", "Never use automation bots or scraped audiences."],
    "Plan dates and platforms for approved drafts. Every item waits for the owner.",
    () => ({ calendar: [{ date: "2026-01-01", platform: "tiktok", draft_ref: "mock", notes: "Mock slot." }] }),
  ),
  SEOAgent: def(
    "SEOAgent",
    "SEO Agent",
    "Reviews page structure, titles, descriptions and content gaps for the public website.",
    "seo",
    ["store.saveArtifact"],
    ["Never edit live pages.", "Never buy links or use link schemes."],
    "Return prioritised recommendations with one concrete action each.",
    () => ({ recommendations: [{ page: "/", issue: "Mock issue.", action: "Mock action.", priority: "low" }] }),
  ),
  SalesAgent: def(
    "SalesAgent",
    "Sales Agent",
    "Ranks requests by follow-up urgency and drafts follow-up messages for the owner to review.",
    "sales",
    ["store.readAggregates", "store.saveArtifact", "approval.propose"],
    ["Never send messages to customers.", "Never receive or store contact details in its context."],
    "Rank references by urgency and reason. Draft polite, specific follow-ups.",
    () => ({ priorities: [{ ref_id: "mock", urgency: "low", reason: "Mock." }], follow_up_drafts: [{ ref_id: "mock", text: "Mock follow-up." }] }),
  ),
  CustomerSupportAgent: def(
    "CustomerSupportAgent",
    "Customer Support Agent",
    "Classifies a pasted customer question and drafts a reply from the approved FAQ.",
    "support",
    ["store.readKnowledge", "store.saveArtifact", "approval.propose"],
    ["Never send replies.", "Never give visa outcome predictions."],
    "Classify the message, flag urgency and draft a reply grounded in the FAQ only.",
    () => ({ classification: "general", urgent: false, draft_reply: "Mock reply. Review before sending." }),
  ),
  CRMAgent: def(
    "CRMAgent",
    "CRM Agent",
    "Proposes data hygiene changes (tags, stale requests, possible duplicates). Changes apply only after approval.",
    "crm",
    ["store.readAggregates", "approval.propose"],
    ["Never delete or export records.", "Never see names, emails or phone numbers."],
    "Propose changes by reference id with a reason.",
    () => ({ proposals: [{ ref_id: "mock", change: "tag:stale", reason: "Mock." }] }),
  ),
  VisaResearchAgent: def(
    "VisaResearchAgent",
    "Visa Research Agent",
    "Maintains requirement sheets built only from official sources the owner provided, with dates.",
    "visa",
    ["store.readKnowledge", "store.saveArtifact", "store.saveMemory"],
    ["Never use unofficial sources as the basis of a requirement.", "Never guarantee a visa outcome."],
    "List each requirement with its official source URL and the date it was last checked.",
    () => ({ requirements: [] }),
  ),
  DataAnalystAgent: def(
    "DataAnalystAgent",
    "Data Analyst Agent",
    "Explains aggregate KPIs and recommends actions. Works on counts only.",
    "analytics",
    ["store.readAggregates", "store.saveArtifact"],
    ["Never request row-level personal data.", "Never run SQL of its own."],
    "Explain the numbers you were given. Do not invent metrics.",
    () => ({ metrics: [], insights: ["Mock insight."], recommendations: ["Mock recommendation."] }),
  ),
  FinanceAgent: def(
    "FinanceAgent",
    "Finance Agent",
    "Summarises received and pending payments per currency and drafts reminders for the owner.",
    "finance",
    ["store.readAggregates", "store.saveArtifact"],
    ["Never move money.", "Never send reminders.", "No bank access."],
    "Summarise amounts per currency. Draft neutral reminder texts.",
    () => ({ summary: [], reminder_drafts: [] }),
  ),
  ComplianceAgent: def(
    "ComplianceAgent",
    "Quality and Compliance Agent",
    "Final gate before owner approval: checks claims, personal data, language quality and AI disclosure.",
    "compliance",
    ["store.saveArtifact"],
    ["Never approve or publish.", "Can only block or pass."],
    "Flag guarantees, fake urgency, invented numbers, personal data and unclear language.",
    () => ({ verdict: "pass", flags: [] }),
  ),
  WebsiteOperationsAgent: def(
    "WebsiteOperationsAgent",
    "Website Operations Agent",
    "Reviews website health reports and proposes fixes as text patches. Never deploys.",
    "website",
    ["store.saveArtifact"],
    ["Never deploy.", "Never push to a protected branch.", "Never change environment variables."],
    "Report checks with a status and propose patches as plain text for the owner to review.",
    () => ({ checks: [{ name: "mock", status: "ok", detail: "Mock check." }], patch_proposals: [] }),
  ),
};

export function getAgent(key: AgentKey): AgentDefinition {
  return AGENT_REGISTRY[key];
}

export function listAgents(): AgentDefinition[] {
  return AGENT_KEYS.map((key) => AGENT_REGISTRY[key]);
}
