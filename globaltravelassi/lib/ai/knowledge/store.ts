import type { KbCategory, KbEntry, KbEntryInput, ReliabilityStatus } from "./rules";
import type { Country, Language } from "../types";

export interface KbFilter {
  category?: KbCategory;
  country?: Country;
  language?: Language;
  reliability?: ReliabilityStatus;
  limit: number;
}

export interface KbStore {
  list(filter: KbFilter): Promise<KbEntry[]>;
  get(id: string): Promise<KbEntry | null>;
  findByKey(category: KbCategory, slug: string, language: Language, country: Country): Promise<KbEntry | null>;
  insert(entry: KbEntryInput, createdBy: string, updatedAt: string): Promise<KbEntry>;
  /** Replaces the content and bumps the version. The version is checked so two edits cannot overwrite each other. */
  update(id: string, expectedVersion: number, patch: Partial<KbEntryInput>, updatedAt: string): Promise<KbEntry>;
}

export class KbVersionConflictError extends Error {
  constructor() {
    super("This entry was changed by someone else. Reload it and retry.");
    this.name = "KbVersionConflictError";
  }
}

/** In-memory knowledge store. Used by tests and local development. */
export class MemoryKbStore implements KbStore {
  private entries = new Map<string, KbEntry>();
  private nextId = 0;

  async list(filter: KbFilter) {
    return [...this.entries.values()]
      .filter((e) => !filter.category || e.category === filter.category)
      .filter((e) => !filter.country || e.country === filter.country)
      .filter((e) => !filter.language || e.language === filter.language)
      .filter((e) => !filter.reliability || e.reliabilityStatus === filter.reliability)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.slug.localeCompare(b.slug))
      .slice(0, filter.limit);
  }

  async get(id: string) {
    return this.entries.get(id) ?? null;
  }

  async findByKey(category: KbCategory, slug: string, language: Language, country: Country) {
    return [...this.entries.values()].find((e) => e.category === category && e.slug === slug && e.language === language && e.country === country) ?? null;
  }

  async insert(entry: KbEntryInput, createdBy: string, updatedAt: string) {
    const record: KbEntry = { ...entry, id: `kb-${++this.nextId}`, version: 1, createdBy, updatedAt };
    this.entries.set(record.id, record);
    return record;
  }

  async update(id: string, expectedVersion: number, patch: Partial<KbEntryInput>, updatedAt: string) {
    const current = this.entries.get(id);
    if (!current) throw new Error("Entry not found.");
    if (current.version !== expectedVersion) throw new KbVersionConflictError();
    const next: KbEntry = { ...current, ...patch, version: current.version + 1, updatedAt };
    this.entries.set(id, next);
    return next;
  }
}
