import type { SourceRecord, SourceStore } from "./service";

/** In-memory registry for tests and local runs. Same rules as the database: one row per host, compare-and-set on updates. */
export class MemorySourceStore implements SourceStore {
  private rows = new Map<string, SourceRecord>();

  async list(): Promise<SourceRecord[]> {
    return [...this.rows.values()].map((r) => ({ ...r }));
  }

  async get(host: string): Promise<SourceRecord | null> {
    const r = this.rows.get(host);
    return r ? { ...r } : null;
  }

  async insert(row: SourceRecord): Promise<void> {
    if (this.rows.has(row.host)) throw new Error("Host already exists.");
    this.rows.set(row.host, { ...row });
  }

  async update(host: string, expectedVersion: number, next: SourceRecord): Promise<boolean> {
    const cur = this.rows.get(host);
    if (!cur || cur.version !== expectedVersion) return false;
    this.rows.set(host, { ...next });
    return true;
  }
}
