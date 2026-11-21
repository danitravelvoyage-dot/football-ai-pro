import "server-only";
import { createAiServices } from "../services";
import { ownerId } from "@/lib/actions/ai";
import { classifyLoadError, type LoadErrorKind } from "../command-center/view";
import { consoleLogger } from "../logging";
import type { FollowUpRecord, LeadListItem, LeadView } from "./service";
import type { FunnelRow } from "./rules";
import type { LeadStage } from "./rules";

export type CrmState =
  | {
      status: "ok";
      leads: LeadListItem[];
      selected: LeadView | null;
      followUps: FollowUpRecord[];
      funnel: { rows: FunnelRow[]; conversionRate: number | null; lostCount: number; activeCount: number };
      generatedAt: string;
    }
  | { status: LoadErrorKind | "unauthorized" };

/** CRM list, the selected lead's detail, open follow-ups and the funnel. Owner session only. */
export async function loadCrm(filter: { stage?: LeadStage; includeArchived: boolean; selectedId?: string }, now: Date = new Date()): Promise<CrmState> {
  try {
    const owner = await ownerId();
    if (!owner) return { status: "unauthorized" };
    const services = await createAiServices();
    const actor = { kind: "owner" as const, id: owner };
    const leads = await services.crm.list(actor, { stage: filter.stage, includeArchived: filter.includeArchived, limit: 100 });
    const selected = filter.selectedId && leads.some((l) => l.lead.id === filter.selectedId) ? await services.crm.view(actor, filter.selectedId) : null;
    const followUps = await services.crm.openFollowUps(actor, 50);
    const funnel = await services.crm.funnel(actor);
    return { status: "ok", leads, selected, followUps, funnel, generatedAt: now.toISOString() };
  } catch (error) {
    const kind = classifyLoadError(error instanceof Error ? error.message : String(error));
    consoleLogger.error("crm.load_failed", { kind });
    return { status: kind };
  }
}
