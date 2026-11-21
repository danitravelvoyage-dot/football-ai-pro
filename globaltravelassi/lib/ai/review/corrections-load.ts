import "server-only";
import { createAiServices } from "../services";
import { ownerId } from "@/lib/actions/ai";
import { classifyLoadError, type LoadErrorKind } from "../command-center/view";
import { consoleLogger } from "../logging";
import type { CorrectionRecord } from "./corrections";

export type CorrectionsState = { status: "ok"; rows: CorrectionRecord[]; generatedAt: string } | { status: LoadErrorKind | "unauthorized" };

/** Every correction, newest first. Owner session only. Read from the append-only audit trail. */
export async function loadCorrections(now: Date = new Date()): Promise<CorrectionsState> {
  try {
    const owner = await ownerId();
    if (!owner) return { status: "unauthorized" };
    const services = await createAiServices();
    const rows = await services.corrections.list({ kind: "owner", id: owner });
    return { status: "ok", rows, generatedAt: now.toISOString() };
  } catch (error) {
    const kind = classifyLoadError(error instanceof Error ? error.message : String(error));
    consoleLogger.error("corrections.load_failed", { kind });
    return { status: kind };
  }
}
