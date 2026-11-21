import "server-only";
import { createAiServices } from "../services";
import { ownerId } from "@/lib/actions/ai";
import { classifyLoadError, type LoadErrorKind } from "../command-center/view";
import { consoleLogger } from "../logging";
import type { NotificationFilter, NotificationRecord } from "./service";

export type InboxView =
  | { status: "ok"; items: NotificationRecord[]; unread: number; generatedAt: string }
  | { status: LoadErrorKind | "unauthorized" };

/** Reads the owner's inbox with the owner's session. Never throws; failures become a state without raw text. */
export async function loadInbox(filter: NotificationFilter, now: Date = new Date()): Promise<InboxView> {
  try {
    const owner = await ownerId();
    if (!owner) return { status: "unauthorized" };
    const services = await createAiServices();
    const actor = { kind: "owner" as const, id: owner };
    const [items, unread] = await Promise.all([services.notifications.list(actor, filter), services.notifications.unreadCount(actor)]);
    return { status: "ok", items, unread, generatedAt: now.toISOString() };
  } catch (error) {
    const kind = classifyLoadError(error instanceof Error ? error.message : String(error));
    consoleLogger.error("notifications.load_failed", { kind });
    return { status: kind };
  }
}
