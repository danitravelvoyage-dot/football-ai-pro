import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import { SupabaseEventStore } from "../store/supabase-event-store";
import { SupabaseContextStore, SupabaseKbStore } from "../store/supabase-platform-store";
import { SupabaseTaskStore } from "../store/supabase-store";
import type { DeliveryRecord, DeliveryStatus, DomainEventRecord } from "../events/store";
import type { ContextEntry } from "../context/store";
import type { KbEntry } from "../knowledge/rules";
import type { AgentRunRecord } from "../orchestration/records";
import { consoleLogger } from "../logging";
import { classifyLoadError, type LoadErrorKind } from "./view";

export const EVENT_LIMIT = 100;
export const DELIVERY_LIMIT = 50;
export const CONTEXT_LIMIT = 200;
export const KNOWLEDGE_LIMIT = 200;
export const AGENT_RUN_LIMIT = 30;

export interface PlatformData {
  status: "ok";
  events: DomainEventRecord[];
  deliveryCounts: Record<DeliveryStatus, number>;
  deadLetters: DeliveryRecord[];
  retrying: DeliveryRecord[];
  context: ContextEntry[];
  knowledge: KbEntry[];
  agentRuns: AgentRunRecord[];
}

export type PlatformState = PlatformData | { status: LoadErrorKind };

/**
 * Reads the event bus, shared context, knowledge base and agent runs with the signed-in administrator's session.
 * Never throws. A failure becomes a state that pages render without raw database messages.
 */
export async function loadPlatform(): Promise<PlatformState> {
  try {
    const db = await createServerSupabase();
    const events = new SupabaseEventStore(db);
    const context = new SupabaseContextStore(db);
    const knowledge = new SupabaseKbStore(db);
    const tasks = new SupabaseTaskStore(db);
    const [recent, deliveryCounts, dead, pending, contextRows, kbRows, runs] = await Promise.all([
      events.listEvents({ limit: EVENT_LIMIT }),
      events.countDeliveries(),
      events.listDeliveries({ status: "dead", limit: DELIVERY_LIMIT }),
      events.listDeliveries({ status: "pending", limit: DELIVERY_LIMIT }),
      context.list({ limit: CONTEXT_LIMIT }),
      knowledge.list({ limit: KNOWLEDGE_LIMIT }),
      tasks.listAgentRuns(AGENT_RUN_LIMIT),
    ]);
    return {
      status: "ok",
      events: recent.items,
      deliveryCounts,
      deadLetters: dead,
      retrying: pending.filter((d) => d.lastError !== null),
      context: contextRows,
      knowledge: kbRows,
      agentRuns: runs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const kind = classifyLoadError(message);
    consoleLogger.error("command_center.platform_load_failed", { kind });
    return { status: kind };
  }
}
