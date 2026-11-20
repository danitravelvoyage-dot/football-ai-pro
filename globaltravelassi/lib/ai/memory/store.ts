import type { DecisionInput } from "./types";

export interface DecisionRecord extends DecisionInput {
  id: string;
  version: number;
  supersedesId: string | null;
  decidedBy: string;
  decidedAt: string;
}

export interface ExperimentRecord {
  id: string;
  kind: "campaign" | "content" | "sales";
  name: string;
  hypothesis: string;
  status: "draft" | "running" | "finished";
  startedAt: string | null;
  endedAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface ResultRecord {
  id: string;
  experimentId: string;
  variant: string;
  metric: string;
  value: number;
  sampleSize: number;
  source: "aggregate" | "manual" | "import";
  period: string;
  recordedBy: string;
  recordedAt: string;
}

export interface MemoryStore {
  latestDecision(subjectType: string, subjectRef: string): Promise<DecisionRecord | null>;
  insertDecision(d: Omit<DecisionRecord, "id">): Promise<DecisionRecord>;
  decisionHistory(subjectType: string, subjectRef: string): Promise<DecisionRecord[]>;
  latestDecisionsBySubject(subjectType?: string): Promise<DecisionRecord[]>;
  insertExperiment(e: Omit<ExperimentRecord, "id" | "createdAt" | "status" | "startedAt" | "endedAt">): Promise<ExperimentRecord>;
  getExperiment(id: string): Promise<ExperimentRecord | null>;
  updateExperimentStatus(id: string, status: ExperimentRecord["status"], at: string): Promise<ExperimentRecord>;
  listExperiments(): Promise<ExperimentRecord[]>;
  insertResult(r: Omit<ResultRecord, "id">): Promise<ResultRecord>;
  resultsFor(experimentId: string): Promise<ResultRecord[]>;
  listResults(): Promise<ResultRecord[]>;
}

/** In-memory memory store with the same rules. Used by tests and local development. */
export class MemoryMemoryStore implements MemoryStore {
  private decisions: DecisionRecord[] = [];
  private experiments: ExperimentRecord[] = [];
  private results: ResultRecord[] = [];
  private nextId = 0;
  private id() {
    return `mem-${++this.nextId}`;
  }

  async latestDecision(subjectType: string, subjectRef: string) {
    return this.decisions.filter((d) => d.subjectType === subjectType && d.subjectRef === subjectRef).sort((a, b) => b.version - a.version)[0] ?? null;
  }

  async insertDecision(d: Omit<DecisionRecord, "id">) {
    if (this.decisions.some((x) => x.subjectType === d.subjectType && x.subjectRef === d.subjectRef && x.version === d.version)) {
      throw new Error("Decision version already exists.");
    }
    const record = { ...d, id: this.id() };
    this.decisions.push(record);
    return record;
  }

  async decisionHistory(subjectType: string, subjectRef: string) {
    return this.decisions.filter((d) => d.subjectType === subjectType && d.subjectRef === subjectRef).sort((a, b) => a.version - b.version);
  }

  async latestDecisionsBySubject(subjectType?: string) {
    const latest = new Map<string, DecisionRecord>();
    for (const d of this.decisions) {
      if (subjectType && d.subjectType !== subjectType) continue;
      const key = `${d.subjectType}|${d.subjectRef}`;
      const current = latest.get(key);
      if (!current || d.version > current.version) latest.set(key, d);
    }
    return [...latest.values()];
  }

  async insertExperiment(e: Omit<ExperimentRecord, "id" | "createdAt" | "status" | "startedAt" | "endedAt">) {
    const record: ExperimentRecord = { ...e, id: this.id(), status: "draft", startedAt: null, endedAt: null, createdAt: new Date(0).toISOString() };
    this.experiments.push(record);
    return record;
  }

  async getExperiment(id: string) {
    return this.experiments.find((e) => e.id === id) ?? null;
  }

  async updateExperimentStatus(id: string, status: ExperimentRecord["status"], at: string) {
    const e = this.experiments.find((x) => x.id === id);
    if (!e) throw new Error("Experiment not found.");
    e.status = status;
    if (status === "running") e.startedAt = at;
    if (status === "finished") e.endedAt = at;
    return { ...e };
  }

  async listExperiments() {
    return [...this.experiments];
  }

  async insertResult(r: Omit<ResultRecord, "id">) {
    const record = { ...r, id: this.id() };
    this.results.push(record);
    return record;
  }

  async resultsFor(experimentId: string) {
    return this.results.filter((r) => r.experimentId === experimentId);
  }

  async listResults() {
    return [...this.results];
  }
}
