import "server-only";
import { createAiServices } from "../services";
import { ownerId } from "@/lib/actions/ai";
import { classifyLoadError, type LoadErrorKind } from "../command-center/view";
import { consoleLogger } from "../logging";
import type { ConflictRecord, PanelRecord, RoutingRecord } from "./store";
import type { ExchangeItem } from "./communication";

export const COLLAB_LIMIT = 50;

export type CollaborationState =
  | {
      status: "ok";
      openConflicts: ConflictRecord[];
      resolvedConflicts: ConflictRecord[];
      panels: PanelRecord[];
      routing: RoutingRecord[];
      /** Outputs the owner must review (quality holds). */
      pendingHolds: number;
      generatedAt: string;
    }
  | { status: LoadErrorKind | "unauthorized" };

/** Conflicts, reviewer decisions and routing decisions for the owner. Owner session only. Never throws. */
export async function loadCollaboration(now: Date = new Date()): Promise<CollaborationState> {
  try {
    const owner = await ownerId();
    if (!owner) return { status: "unauthorized" };
    const services = await createAiServices();
    const actor = { kind: "owner" as const, id: owner };
    const [openConflicts, resolvedConflicts, panels, routing, pending] = await Promise.all([
      services.collaboration.listConflicts(actor, { status: "open", limit: COLLAB_LIMIT }),
      services.collaboration.listConflicts(actor, { status: "resolved", limit: COLLAB_LIMIT }),
      services.collaboration.listPanels(actor, { limit: COLLAB_LIMIT }),
      services.collaboration.listRouting(actor, { limit: COLLAB_LIMIT }),
      services.store.listApprovals("pending"),
    ]);
    return {
      status: "ok",
      openConflicts,
      resolvedConflicts,
      panels,
      routing,
      pendingHolds: pending.filter((a) => a.actionClass === "propose_change").length,
      generatedAt: now.toISOString(),
    };
  } catch (error) {
    const kind = classifyLoadError(error instanceof Error ? error.message : String(error));
    consoleLogger.error("collaboration.load_failed", { kind });
    return { status: kind };
  }
}

/** Questions and answers for each run shown on the page. Owner session only. Never throws. */
export async function loadExchanges(runIds: string[]): Promise<Record<string, ExchangeItem[]>> {
  try {
    const owner = await ownerId();
    if (!owner) return {};
    const services = await createAiServices();
    const out: Record<string, ExchangeItem[]> = {};
    for (const runId of runIds) out[runId] = await services.communication.exchanges(runId);
    return out;
  } catch (error) {
    consoleLogger.error("collaboration.exchanges_failed", { reason: error instanceof Error ? error.name : "unknown" });
    return {};
  }
}
