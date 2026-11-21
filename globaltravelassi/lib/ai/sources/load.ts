import "server-only";
import { createAiServices } from "../services";
import { ownerId } from "@/lib/actions/ai";
import { classifyLoadError, type LoadErrorKind } from "../command-center/view";
import { consoleLogger } from "../logging";
import type { SourceRecord } from "./service";

export type SourceRow = SourceRecord & { usable: boolean; revalidationDue: boolean };
export type SourcesState = { status: "ok"; rows: SourceRow[]; generatedAt: string } | { status: LoadErrorKind | "unauthorized" };

/** The registry, official sources first. Owner session only. */
export async function loadSources(now: Date = new Date()): Promise<SourcesState> {
  try {
    const owner = await ownerId();
    if (!owner) return { status: "unauthorized" };
    const services = await createAiServices();
    const rows = await services.sources.list({ kind: "owner", id: owner });
    return { status: "ok", rows, generatedAt: now.toISOString() };
  } catch (error) {
    const kind = classifyLoadError(error instanceof Error ? error.message : String(error));
    consoleLogger.error("sources.load_failed", { kind });
    return { status: kind };
  }
}
