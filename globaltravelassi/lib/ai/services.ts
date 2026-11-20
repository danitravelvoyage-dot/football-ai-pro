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
  audit: AuditSink;
  usage: UsageStore;
  providers: ProviderConfig[];
}

/** Composition root: wires the engine to Supabase with the signed-in admin's session. */
export async function createAiServices(): Promise<AiServices> {
  const db = await createServerSupabase();
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
  });
  const memory = new MemoryService({ store: new SupabaseMemoryStore(db), audit, now, newId });
  return { orchestrator, store, events: platform.events, context: platform.context, knowledge: platform.knowledge, quality: platform.quality, memory, audit, usage, providers: configs };
}

async function loadVisaAllowlist(db: Awaited<ReturnType<typeof createServerSupabase>>): Promise<string[]> {
  const { data } = await db.from("ai_sources_allowlist").select("host");
  return (data ?? []).map((r) => (r as { host: string }).host);
}
