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
import type { Notice } from "./notifications/rules";

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
  });
  return { orchestrator, store, events: platform.events, context: platform.context, knowledge: platform.knowledge, quality: platform.quality, memory, scheduler, notifications, audit, usage, providers: configs };
}

async function loadVisaAllowlist(db: Awaited<ReturnType<typeof createServerSupabase>>): Promise<string[]> {
  const { data } = await db.from("ai_sources_allowlist").select("host");
  return (data ?? []).map((r) => (r as { host: string }).host);
}
