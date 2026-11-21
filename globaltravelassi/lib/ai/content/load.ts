import "server-only";
import { createAiServices } from "../services";
import { ownerId } from "@/lib/actions/ai";
import { classifyLoadError, type LoadErrorKind } from "../command-center/view";
import { consoleLogger } from "../logging";

export type ContentInboxState =
  | { status: "ok"; items: Awaited<ReturnType<Awaited<ReturnType<typeof createAiServices>>["content"]["inbox"]>>; generatedAt: string }
  | { status: LoadErrorKind | "unauthorized" };

/** Pending content for the owner's review, with each item's latest quality review. Owner session only. */
export async function loadContentInbox(now: Date = new Date()): Promise<ContentInboxState> {
  try {
    const owner = await ownerId();
    if (!owner) return { status: "unauthorized" };
    const services = await createAiServices();
    const items = await services.content.inbox({ kind: "owner", id: owner });
    return { status: "ok", items, generatedAt: now.toISOString() };
  } catch (error) {
    const kind = classifyLoadError(error instanceof Error ? error.message : String(error));
    consoleLogger.error("content.load_failed", { kind });
    return { status: kind };
  }
}
