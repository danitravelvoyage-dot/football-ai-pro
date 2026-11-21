import type { QualityStatus } from "../quality/types";
import type { Verdict } from "./consensus";
import type { ConsensusDecision } from "./consensus";

/** Records of the multi-agent layer. Codes, identifiers and decisions only: no customer or output text. */

export interface PanelVote {
  reviewer: string;
  verdict: Verdict;
  codes: string[];
}

export interface PanelRecord {
  id: string;
  taskId: string;
  runId: string;
  producer: string;
  attempt: number;
  status: QualityStatus;
  decision: ConsensusDecision;
  votes: PanelVote[];
  counted: string[];
  excluded: { reviewer: string; reason: string }[];
  reasons: string[];
  disagreement: boolean;
  createdAt: string;
}

export interface RoutingRecord {
  id: string;
  runId: string;
  taskId: string;
  stepKey: string;
  capability: string;
  templateAgent: string;
  chosenAgent: string;
  reasons: string[];
  candidates: number;
  createdAt: string;
}

export interface ConflictRecord {
  id: string;
  runId: string;
  taskId: string | null;
  subjectKey: string;
  parties: string[];
  codes: string[];
  status: "open" | "resolved";
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  detectedAt: string;
}

export interface CollaborationStore {
  savePanel(p: PanelRecord): Promise<void>;
  /** Newest first. Optionally limited to one run. */
  listPanels(filter: { runId?: string; limit: number }): Promise<PanelRecord[]>;
  saveRouting(r: RoutingRecord): Promise<void>;
  listRouting(filter: { runId?: string; limit: number }): Promise<RoutingRecord[]>;
  /** Stores a conflict once per run and subject. Returns created = false when it already exists. */
  recordConflict(c: ConflictRecord): Promise<{ created: boolean }>;
  /** Newest first. */
  listConflicts(filter: { status?: "open" | "resolved"; limit: number }): Promise<ConflictRecord[]>;
  getConflict(id: string): Promise<ConflictRecord | null>;
  /** Writes the resolution of an open conflict. Refused for a conflict that is already resolved. */
  resolveConflict(c: ConflictRecord): Promise<void>;
}

/** In-memory store with the same rules as migration 0017. Used by tests and local development. */
export class MemoryCollaborationStore implements CollaborationStore {
  private panels: PanelRecord[] = [];
  private routing: RoutingRecord[] = [];
  private conflicts = new Map<string, ConflictRecord>();

  async savePanel(p: PanelRecord): Promise<void> {
    if (this.panels.some((x) => x.taskId === p.taskId && x.attempt === p.attempt)) throw new Error("A panel for this attempt already exists.");
    this.panels.push({ ...p, votes: p.votes.map((v) => ({ ...v, codes: [...v.codes] })) });
  }

  async listPanels(filter: { runId?: string; limit: number }): Promise<PanelRecord[]> {
    return this.panels
      .filter((p) => (filter.runId ? p.runId === filter.runId : true))
      .slice()
      .reverse()
      .slice(0, filter.limit);
  }

  async saveRouting(r: RoutingRecord): Promise<void> {
    this.routing.push({ ...r });
  }

  async listRouting(filter: { runId?: string; limit: number }): Promise<RoutingRecord[]> {
    return this.routing
      .filter((r) => (filter.runId ? r.runId === filter.runId : true))
      .slice()
      .reverse()
      .slice(0, filter.limit);
  }

  async recordConflict(c: ConflictRecord): Promise<{ created: boolean }> {
    const exists = [...this.conflicts.values()].some((x) => x.runId === c.runId && x.subjectKey === c.subjectKey);
    if (exists) return { created: false };
    this.conflicts.set(c.id, { ...c, parties: [...c.parties], codes: [...c.codes] });
    return { created: true };
  }

  async listConflicts(filter: { status?: "open" | "resolved"; limit: number }): Promise<ConflictRecord[]> {
    return [...this.conflicts.values()]
      .filter((c) => (filter.status ? c.status === filter.status : true))
      .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt) || b.id.localeCompare(a.id))
      .slice(0, filter.limit)
      .map((c) => ({ ...c }));
  }

  async getConflict(id: string): Promise<ConflictRecord | null> {
    const c = this.conflicts.get(id);
    return c ? { ...c } : null;
  }

  async resolveConflict(c: ConflictRecord): Promise<void> {
    const current = this.conflicts.get(c.id);
    if (!current) throw new Error("Conflict not found.");
    if (current.status === "resolved") throw new Error("A resolved conflict cannot change.");
    this.conflicts.set(c.id, { ...c });
  }
}
