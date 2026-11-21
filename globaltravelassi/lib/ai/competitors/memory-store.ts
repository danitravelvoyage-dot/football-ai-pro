import type { CompetitorStore, ObservationRecord, SourceRecord } from "./service";

/** In-memory store with the same contract as the Supabase store. Used by tests and local development. */
export class MemoryCompetitorStore implements CompetitorStore {
  private sources = new Map<string, SourceRecord>();
  private observations: ObservationRecord[] = [];

  async insertSource(s: SourceRecord): Promise<void> {
    this.sources.set(s.id, { ...s });
  }

  async getSource(id: string): Promise<SourceRecord | null> {
    const s = this.sources.get(id);
    return s ? { ...s } : null;
  }

  async listSources(filter: { activeOnly: boolean }): Promise<SourceRecord[]> {
    return [...this.sources.values()].filter((s) => (filter.activeOnly ? s.active : true)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).map((s) => ({ ...s }));
  }

  async saveSource(s: SourceRecord): Promise<void> {
    if (!this.sources.has(s.id)) throw new Error("Source not found.");
    this.sources.set(s.id, { ...s });
  }

  async addObservation(o: ObservationRecord): Promise<void> {
    this.observations.push({ ...o, offers: [...o.offers], changes: [...o.changes] });
  }

  async listObservations(sourceId: string, limit: number): Promise<ObservationRecord[]> {
    // Insertion order is the true sequence, so the newest is the last one written, even when timestamps tie.
    return this.observations.filter((o) => o.sourceId === sourceId).reverse().slice(0, limit);
  }
}
