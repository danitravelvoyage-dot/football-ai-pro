import "server-only";
import { createAiServices } from "../services";
import { ownerId } from "@/lib/actions/ai";
import { classifyLoadError, type LoadErrorKind } from "../command-center/view";
import { consoleLogger } from "../logging";
import type { KbEntry } from "./rules";
import type { KbSearch } from "./search";
import type { KbVersion } from "./store";

export type KnowledgeAdminState =
  | { status: "ok"; entries: KbEntry[]; selected: KbEntry | null; history: KbVersion[]; generatedAt: string }
  | { status: LoadErrorKind | "unauthorized" };

/** Owner search over the knowledge base, with the selected entry and its version history. Owner session only. */
export async function loadKnowledgeAdmin(q: KbSearch, selectedId: string | undefined, now: Date = new Date()): Promise<KnowledgeAdminState> {
  try {
    const owner = await ownerId();
    if (!owner) return { status: "unauthorized" };
    const services = await createAiServices();
    const actor = { kind: "owner" as const, id: owner };
    const entries = await services.knowledge.search(actor, q);
    const selected = selectedId ? entries.find((e) => e.id === selectedId) ?? null : null;
    const history = selected ? await services.knowledge.history(actor, selected.id) : [];
    return { status: "ok", entries, selected, history, generatedAt: now.toISOString() };
  } catch (error) {
    const kind = classifyLoadError(error instanceof Error ? error.message : String(error));
    consoleLogger.error("knowledge.load_failed", { kind });
    return { status: kind };
  }
}
