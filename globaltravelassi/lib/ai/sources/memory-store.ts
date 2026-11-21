import type { SourceRecord, SourceStore } from "./service";

/**
 * In-memory registry for tests and local runs. Same rules as the database: one row per host, compare-and-set on updates,
 * and a retired host leaves only through reactivate().
 */
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
    if (cur.status === "retired") return false;
    this.rows.set(host, { ...next });
    return true;
  }

  async reactivate(host: string, expectedVersion: number, reason: string): Promise<boolean> {
    const cur = this.rows.get(host);
    if (!cur || cur.version !== expectedVersion || cur.status !== "retired") return false;
    this.rows.set(host, { ...cur, status: "active", version: cur.version + 1, lastChangeReason: reason, updatedAt: new Date().toISOString() });
    return true;
  }
}
