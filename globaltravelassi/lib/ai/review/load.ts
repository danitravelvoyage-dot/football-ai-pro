import "server-only";
import { createAiServices } from "../services";
import { ownerId } from "@/lib/actions/ai";
import { classifyLoadError, type LoadErrorKind } from "../command-center/view";
import { consoleLogger } from "../logging";
import type { ReviewItem } from "./service";

export type ReviewState =
  | { status: "ok"; open: ReviewItem[]; decided: ReviewItem[]; generatedAt: string }
  | { status: LoadErrorKind | "unauthorized" };

/** Open and decided review items, newest first. Owner session only. Items are read through the review service. */
export async function loadReview(now: Date = new Date()): Promise<ReviewState> {
  try {
    const owner = await ownerId();
    if (!owner) return { status: "unauthorized" };
    const services = await createAiServices();
    const all = await services.review.list({ kind: "owner", id: owner }, { limit: 200 });
    const byNewest = (a: ReviewItem, b: ReviewItem) => b.createdAt.localeCompare(a.createdAt);
    return {
      status: "ok",
      open: all.filter((i) => i.status === "open").sort(byNewest),
      decided: all.filter((i) => i.status !== "open").sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? "")),
      generatedAt: now.toISOString(),
    };
  } catch (error) {
    const kind = classifyLoadError(error instanceof Error ? error.message : String(error));
    consoleLogger.error("review.load_failed", { kind });
    return { status: kind };
  }
}
