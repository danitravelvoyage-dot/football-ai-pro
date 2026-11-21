import "server-only";
import { createAiServices } from "../services";
import { ownerId } from "@/lib/actions/ai";
import { classifyLoadError, type LoadErrorKind } from "../command-center/view";
import { consoleLogger } from "../logging";
import type { CampaignRecord, CampaignView } from "./service";
import type { CampaignStatus } from "./rules";

export type CampaignsState =
  | { status: "ok"; campaigns: CampaignRecord[]; selected: CampaignView | null; pipeline: { id: string; kind: string; status: string }[]; generatedAt: string }
  | { status: LoadErrorKind | "unauthorized" };

/** Campaign list, the selected campaign's detail, and the content pipeline for assignment. Owner session only. */
export async function loadCampaigns(filter: { status?: CampaignStatus; includeArchived: boolean; selectedId?: string }, now: Date = new Date()): Promise<CampaignsState> {
  try {
    const owner = await ownerId();
    if (!owner) return { status: "unauthorized" };
    const services = await createAiServices();
    const actor = { kind: "owner" as const, id: owner };
    const campaigns = await services.campaigns.list(actor, { status: filter.status, includeArchived: filter.includeArchived, limit: 100 });
    const selected = filter.selectedId && campaigns.some((c) => c.id === filter.selectedId) ? await services.campaigns.view(actor, filter.selectedId) : null;
    const pipeline = (await services.content.inbox(actor, ["draft", "awaiting_owner", "approved"], 100)).map((i) => ({
      id: i.artifact.id,
      kind: i.artifact.kind,
      status: i.artifact.status,
    }));
    return { status: "ok", campaigns, selected, pipeline, generatedAt: now.toISOString() };
  } catch (error) {
    const kind = classifyLoadError(error instanceof Error ? error.message : String(error));
    consoleLogger.error("campaigns.load_failed", { kind });
    return { status: kind };
  }
}
