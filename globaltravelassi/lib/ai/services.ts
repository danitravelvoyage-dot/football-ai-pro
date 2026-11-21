import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import { ApprovalService } from "./approvals";
import { MockProvider } from "./llm/mock-provider";
import { OpenAICompatibleProvider } from "./llm/openai-compatible";
import { loadProviderConfig, type ProviderConfig } from "./llm/config";
import { LLMGateway, type UsageStore } from "./llm/gateway";
import type { LLMProvider } from "./llm/types";
import { consoleLogger } from "./logging";
import { Orchestrator } from "./orchestration/engine";
import type { TaskStore } from "./orchestration/store";
import { AgentRuntime } from "./runtime";
import { SupabaseAuditSink, SupabaseTaskStore, SupabaseUsageStore } from "./store/supabase-store";
import { SupabaseEventStore } from "./store/supabase-event-store";
import { SupabaseContextStore, SupabaseKbStore } from "./store/supabase-platform-store";
import { SupabaseQualityStore } from "./store/supabase-quality-store";
import { SupabaseMemoryStore } from "./store/supabase-memory-store";
import { MemoryService } from "./memory/service";
import { buildPlatform } from "./platform";
import type { ContextService } from "./context/service";
import type { KbService } from "./knowledge/service";
import type { QualityController } from "./quality/controller";
import type { EventBus } from "./events/bus";
import type { AuditSink } from "./audit";
import { SchedulerService, type CycleReport } from "./scheduler/service";
import { SupabaseSchedulerStore } from "./scheduler/supabase-store";
import { NotificationService } from "./notifications/service";
import { SupabaseNotificationStore } from "./notifications/supabase-store";
import { postAgentSummary } from "./notifications/summary";
import { postOwnerReport } from "./notifications/report";
import { CampaignService } from "./campaigns/service";
import { SupabaseCampaignStore } from "./campaigns/supabase-store";
import { ContentReviewService } from "./content/review";
import { SupabaseContentStore } from "./content/supabase-store";
import type { Notice } from "./notifications/rules";
import { CrmService } from "./crm/service";
import { SupabaseCrmStore } from "./crm/supabase-store";
import { CompetitorService } from "./competitors/service";
import { SupabaseCompetitorStore } from "./competitors/supabase-store";
import type { HttpFetch } from "./competitors/fetch";
import { BusinessReportService } from "./business/service";
import { StageAnswerService } from "./factual/stage-answer";
import { SupabaseCollaborationStore } from "./collaboration/supabase-store";
import { CollaborationService } from "./collaboration/service";
import { CommunicationService } from "./collaboration/communication";

/** Builds provider adapters from configuration. Secrets are read here, on the server, and never returned. */
export function buildProviders(configs: ProviderConfig[]): { config: ProviderConfig; provider: LLMProvider }[] {
  return configs.map((config) => {
    if (config.kind === "mock") {
      return { config, provider: new MockProvider(config.id) };
    }
    const secretName = config.secretEnv;
    return {
      config,
      provider: new OpenAICompatibleProvider({
        id: config.id,
        baseUrl: config.baseUrl ?? "",
        model: config.model ?? "",
        getSecret: secretName ? () => process.env[secretName] : undefined,
      }),
    };
  });
}

export interface AiServices {
  orchestrator: Orchestrator;
  store: TaskStore;
  events: EventBus;
  context: ContextService;
  knowledge: KbService;
  quality: QualityController;
  memory: MemoryService;
  scheduler: SchedulerService;
  notifications: NotificationService;
  campaigns: CampaignService;
  content: ContentReviewService;
  crm: CrmService;
  competitors: CompetitorService;
  businessReports: BusinessReportService;
  collaboration: CollaborationService;
  communication: CommunicationService;
  stageAnswers: StageAnswerService;
  audit: AuditSink;
  usage: UsageStore;
  providers: ProviderConfig[];
}

/** Name of the scheduler in the heartbeat table. One name for every run of this application. */
export const SCHEDULER_WORKER_NAME = "scheduler";

export type AiDatabase = Awaited<ReturnType<typeof createServerSupabase>>;

/** Composition root: wires the engine to Supabase with the signed-in admin's session. */
export async function createAiServices(): Promise<AiServices> {
  return buildAiServices(await createServerSupabase());
}

/** Builds every service on the given database session. The scheduler worker passes its operator session here. */
export async function buildAiServices(db: AiDatabase): Promise<AiServices> {
  const store = new SupabaseTaskStore(db);
  const audit = new SupabaseAuditSink(db);
  const usage = new SupabaseUsageStore(db);
  const configs = loadProviderConfig(process.env);
  const gateway = new LLMGateway({
    providers: buildProviders(configs),
    usage,
    now: () => new Date(),
    onEvent: (e) => consoleLogger.info(e.type, { providerId: e.providerId }),
  });
  const runtime = new AgentRuntime(gateway);
  const newId = () => crypto.randomUUID();
  const now = () => new Date();
  const approvals = new ApprovalService({ store, audit, now, newId });
  const visaHosts = await loadVisaAllowlist(db);
  const platform = buildPlatform(
    { tasks: store, events: new SupabaseEventStore(db), context: new SupabaseContextStore(db), knowledge: new SupabaseKbStore(db), quality: new SupabaseQualityStore(db), audit },
    { now, newId },
  );
  const memory = new MemoryService({ store: new SupabaseMemoryStore(db), audit, now, newId });
  const notifications = new NotificationService({ store: new SupabaseNotificationStore(db), audit, now, newId });
  const notify = (notice: Notice) => notifications.notify(notice);
  const collaborationStore = new SupabaseCollaborationStore(db);
  const orchestrator = new Orchestrator({
    store,
    runtime,
    approvals,
    audit,
    logger: consoleLogger,
    now,
    newId,
    visaAllowlist: () => visaHosts,
    events: platform.events,
    context: platform.context,
    knowledge: platform.knowledge,
    quality: platform.quality,
    // Owner memory for agent runs, built by the platform with a system actor. Agents cannot request it.
    briefing: () => memory.briefing({ kind: "system" }),
    notify,
    collaboration: collaborationStore,
  });
  const eventStore = new SupabaseEventStore(db);
  const scheduler = new SchedulerService({
    store: new SupabaseSchedulerStore(db),
    // One cycle: expiry sweep, stale-task recovery, readiness, task claims and event dispatch.
    runCycle: async (): Promise<CycleReport> => {
      const tick = await orchestrator.tick({ limit: 5 });
      // The owner's daily agent summary is written from the same cycle. The dedupe key keeps it to one per day.
      const summaryWritten = await postAgentSummary(await store.listAgentRuns(1000), notifications, now());
      return { ...tick, agentSummaryWritten: summaryWritten ? 1 : 0 };
    },
    audit,
    now,
    newId,
    logger: consoleLogger,
    workerName: SCHEDULER_WORKER_NAME,
    deadEventDeliveries: async () => (await eventStore.countDeliveries()).dead,
    notify,
    ownerReport: async (schedulerStatus) => postOwnerReport(await store.listAgentRuns(1000), notifications, schedulerStatus, now()),
  });
  const contentStore = new SupabaseContentStore(db);
  const content = new ContentReviewService({
    store: contentStore,
    context: platform.context,
    audit,
    now,
    newId,
    latestQuality: async (taskId) => {
      const reviews = await platform.quality.history({ kind: "system" }, taskId);
      const latest = [...reviews].sort((a, b) => b.attempt - a.attempt)[0];
      return latest ? { status: latest.status, overall: latest.overall } : null;
    },
  });
  const campaigns = new CampaignService({
    store: new SupabaseCampaignStore(db),
    audit,
    now,
    newId,
    contentStatus: async (ids) => {
      const out = new Map<string, string>();
      for (const id of ids) {
        const a = await contentStore.get(id);
        if (a) out.set(id, a.status);
      }
      return out;
    },
  });
  const crm = new CrmService({ store: new SupabaseCrmStore(db), audit, now, newId });
  const competitors = new CompetitorService({ store: new SupabaseCompetitorStore(db), fetch: ((url, init) => fetch(url, init)) as HttpFetch, audit, now, newId });
  const collaboration = new CollaborationService({ store: collaborationStore, audit, now, newId });
  const communication = new CommunicationService({ approvedHosts: () => visaHosts, bus: platform.events, events: eventStore, runtime, quality: platform.quality, collaboration: collaborationStore, audit, now, newId });
  const stageAnswers = new StageAnswerService({ runtime, crm, audit, now, newId });
  const businessReports = new BusinessReportService({ crm, campaigns, competitors, notify: (n) => notifications.notify(n), audit, now, newId });
  return { orchestrator, store, events: platform.events, context: platform.context, knowledge: platform.knowledge, quality: platform.quality, memory, scheduler, notifications, campaigns, content, crm, competitors, businessReports, collaboration, communication, stageAnswers, audit, usage, providers: configs };
}

async function loadVisaAllowlist(db: Awaited<ReturnType<typeof createServerSupabase>>): Promise<string[]> {
  const { data } = await db.from("ai_sources_allowlist").select("host");
  return (data ?? []).map((r) => (r as { host: string }).host);
}
