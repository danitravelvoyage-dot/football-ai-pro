import "server-only";
import { createAiServices } from "../services";
import { ownerId } from "@/lib/actions/ai";
import { consoleLogger } from "../logging";

export interface OwnerSummary {
  activeCampaigns: number | null;
  contentWaiting: number | null;
  unreadNotices: number | null;
  schedulerStatus: string | null;
  knowledgeEntries: number | null;
}

/**
 * Counts for the unified owner view, read from the owning service of each module. A module that cannot be read
 * gives null, which the page shows as unavailable. Nothing is estimated or defaulted to zero.
 */
export async function loadOwnerSummary(): Promise<OwnerSummary | "unauthorized"> {
  const owner = await ownerId();
  if (!owner) return "unauthorized";
  const actor = { kind: "owner" as const, id: owner };
  const nothing: OwnerSummary = { activeCampaigns: null, contentWaiting: null, unreadNotices: null, schedulerStatus: null, knowledgeEntries: null };
  try {
    const services = await createAiServices();
    const [campaigns, content, unread, health, knowledge] = await Promise.allSettled([
      services.campaigns.list(actor, { status: "active", includeArchived: false, limit: 200 }),
      services.content.inbox(actor, ["draft", "awaiting_owner"], 200),
      services.notifications.unreadCount(actor),
      services.scheduler.health(),
      services.knowledge.search(actor, {}),
    ]);
    return {
      activeCampaigns: campaigns.status === "fulfilled" ? campaigns.value.length : null,
      contentWaiting: content.status === "fulfilled" ? content.value.length : null,
      unreadNotices: unread.status === "fulfilled" ? unread.value : null,
      schedulerStatus: health.status === "fulfilled" ? health.value.status : null,
      knowledgeEntries: knowledge.status === "fulfilled" ? knowledge.value.length : null,
    };
  } catch (error) {
    consoleLogger.error("command_center.summary_failed", { reason: error instanceof Error ? error.name : "unknown" });
    return nothing;
  }
}
