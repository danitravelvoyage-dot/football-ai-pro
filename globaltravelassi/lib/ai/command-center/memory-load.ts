import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import { SupabaseMemoryStore } from "../store/supabase-memory-store";
import { SupabaseContextStore } from "../store/supabase-platform-store";
import { MemoryService } from "../memory/service";
import type { LearningSettings } from "../memory/types";
import type { DecisionRecord, ExperimentRecord, ResultRecord } from "../memory/store";
import { outdatedStrategies } from "../memory/learning";
import { profileFrom, type ProfileItem } from "../memory/business-context";
import { consoleLogger } from "../logging";
import { classifyLoadError, type LoadErrorKind } from "./view";
import type { Actor } from "../types";

export interface MemoryData {
  status: "ok";
  decisions: DecisionRecord[];
  history: DecisionRecord[];
  outdated: DecisionRecord[];
  experiments: ExperimentRecord[];
  results: ResultRecord[];
  settings: LearningSettings;
}

export interface ProfileData {
  status: "ok";
  profile: ProfileItem[];
}

export type MemoryState = MemoryData | { status: LoadErrorKind };
export type ProfileState = ProfileData | { status: LoadErrorKind };

/** Reads owner memory as the owner. The service applies its own permission rules to every read. */
export async function loadMemory(owner: Actor, subject: { type: string; ref: string } | null, now = new Date()): Promise<MemoryState> {
  try {
    const db = await createServerSupabase();
    const store = new SupabaseMemoryStore(db);
    const service = new MemoryService({ store, audit: { write: async () => undefined }, now: () => now, newId: () => "" });
    const [decisions, experiments, results, settings] = await Promise.all([
      store.latestDecisionsBySubject(),
      store.listExperiments(),
      store.listResults(),
      service.learningSettings(owner),
    ]);
    const history = subject ? await service.decisionHistory(owner, subject.type, subject.ref) : [];
    return { status: "ok", decisions, history, outdated: outdatedStrategies(decisions, now), experiments, results, settings };
  } catch (error) {
    const kind = classifyLoadError(error instanceof Error ? error.message : String(error));
    consoleLogger.error("command_center.memory_load_failed", { kind });
    return { status: kind };
  }
}

export async function loadProfile(): Promise<ProfileState> {
  try {
    const db = await createServerSupabase();
    const entries = await new SupabaseContextStore(db).list({ scope: "company", scopeKey: "company", limit: 200 });
    return { status: "ok", profile: profileFrom(entries) };
  } catch (error) {
    const kind = classifyLoadError(error instanceof Error ? error.message : String(error));
    consoleLogger.error("command_center.profile_load_failed", { kind });
    return { status: kind };
  }
}

