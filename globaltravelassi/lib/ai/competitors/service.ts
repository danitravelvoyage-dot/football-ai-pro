import type { AuditSink } from "../audit";
import { assertNoPersonalData, PersonalDataError } from "../security/personal-data";
import type { Actor } from "../types";
import { fetchPublicPage, type HttpFetch } from "./fetch";
import {
  checkSourceUrl,
  contentHash,
  detectChanges,
  extractOffers,
  isDue,
  opportunitiesFrom,
  sourceInputSchema,
  visibleText,
  type Change,
  type Offer,
  type ObservationStatus,
  type Opportunity,
  type SourceInput,
  type SourceKind,
} from "./rules";

export class CompetitorForbiddenError extends Error {
  constructor(message = "Only the owner manages competitor monitoring.") {
    super(message);
    this.name = "CompetitorForbiddenError";
  }
}
export class CompetitorValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompetitorValidationError";
  }
}

export interface SourceRecord {
  id: string;
  name: string;
  url: string;
  host: string;
  kind: SourceKind;
  purpose: string;
  termsReviewedBy: string;
  termsReviewedAt: string;
  minIntervalHours: number;
  active: boolean;
  lastCheckedAt: string | null;
  lastStatus: ObservationStatus | null;
  createdAt: string;
}

export interface ObservationRecord {
  id: string;
  sourceId: string;
  observedAt: string;
  status: ObservationStatus;
  contentHash: string | null;
  offers: Offer[];
  changes: Change[];
}

export interface CompetitorStore {
  insertSource(s: SourceRecord): Promise<void>;
  getSource(id: string): Promise<SourceRecord | null>;
  listSources(filter: { activeOnly: boolean }): Promise<SourceRecord[]>;
  saveSource(s: SourceRecord): Promise<void>;
  addObservation(o: ObservationRecord): Promise<void>;
  /** Newest first. */
  listObservations(sourceId: string, limit: number): Promise<ObservationRecord[]>;
}

export interface CompetitorServiceDeps {
  store: CompetitorStore;
  fetch: HttpFetch;
  audit: AuditSink;
  now: () => Date;
  newId: () => string;
}

export interface MonitorSummary {
  checked: number;
  skipped: number;
  changed: number;
  failed: number;
}

export interface SourceReport {
  source: SourceRecord;
  latestStatus: ObservationStatus | null;
  latestObservedAt: string | null;
  offerCount: number;
  lowestByCurrency: { currency: string; amountMinor: number }[];
  changes: Change[];
  opportunities: Opportunity[];
}

const owner = (actor: Actor): string => {
  if (actor.kind !== "owner") throw new CompetitorForbiddenError();
  if (actor.id.trim().length === 0) throw new CompetitorForbiddenError("The owner identity is missing.");
  return actor.id;
};

/**
 * Competitor intelligence, phase 1: registered public sources, scheduled reads with robots and terms checks, change
 * detection and owner reports. The owner registers and runs it. Nothing here publishes, contacts a competitor or
 * acts on the results. Results are data for the owner's decisions.
 */
export class CompetitorService {
  constructor(private readonly deps: CompetitorServiceDeps) {}

  private nowIso(): string {
    return this.deps.now().toISOString();
  }

  async registerSource(actor: Actor, raw: unknown): Promise<SourceRecord> {
    const by = owner(actor);
    const parsed = sourceInputSchema.safeParse(raw);
    if (!parsed.success) throw new CompetitorValidationError(parsed.error.issues[0]?.message ?? "Source input is invalid.");
    const input: SourceInput = parsed.data;
    const url = checkSourceUrl(input.url);
    if (!url.ok) throw new CompetitorValidationError(`This URL cannot be monitored (${url.reason}).`);
    try {
      assertNoPersonalData({ name: input.name, purpose: input.purpose });
    } catch (error) {
      if (error instanceof PersonalDataError) throw new CompetitorValidationError("Text contains personal data and was refused.");
      throw error;
    }
    const at = this.nowIso();
    const record: SourceRecord = {
      id: this.deps.newId(),
      name: input.name,
      url: url.url,
      host: url.host,
      kind: input.kind,
      purpose: input.purpose,
      termsReviewedBy: by,
      termsReviewedAt: at,
      minIntervalHours: input.minIntervalHours,
      active: true,
      lastCheckedAt: null,
      lastStatus: null,
      createdAt: at,
    };
    await this.deps.store.insertSource(record);
    await this.audit(by, "source_registered", record.id, { host: record.host, kind: record.kind });
    return record;
  }

  async setActive(actor: Actor, sourceId: string, active: boolean): Promise<SourceRecord> {
    const by = owner(actor);
    const s = await this.deps.store.getSource(sourceId);
    if (!s) throw new CompetitorValidationError("Source not found.");
    const updated = { ...s, active };
    await this.deps.store.saveSource(updated);
    await this.audit(by, active ? "source_activated" : "source_paused", sourceId, {});
    return updated;
  }

  async listSources(actor: Actor): Promise<SourceRecord[]> {
    owner(actor);
    return this.deps.store.listSources({ activeOnly: false });
  }

  /**
   * Reads every active source whose interval has passed. A failed read is recorded as an observation with its status,
   * so the history shows gaps honestly. A source is never read more often than its interval.
   */
  async monitor(actor: Actor, opts: { force?: boolean } = {}): Promise<MonitorSummary> {
    const by = owner(actor);
    const summary: MonitorSummary = { checked: 0, skipped: 0, changed: 0, failed: 0 };
    const now = this.nowIso();
    for (const source of await this.deps.store.listSources({ activeOnly: true })) {
      if (!opts.force && !isDue(source.lastCheckedAt, now, source.minIntervalHours)) {
        summary.skipped += 1;
        continue;
      }
      summary.checked += 1;
      const page = await fetchPublicPage(this.deps.fetch, source.url);
      let offers: Offer[] = [];
      let hash: string | null = null;
      let changes: Change[] = [];
      if (page.status === "ok" && page.html !== undefined) {
        const text = visibleText(page.html);
        hash = contentHash(text);
        offers = extractOffers(text);
        const previous = (await this.deps.store.listObservations(source.id, 20)).find((o) => o.status === "ok") ?? null;
        changes = detectChanges(previous ? { contentHash: previous.contentHash ?? "", offers: previous.offers } : null, { contentHash: hash, offers });
      } else {
        summary.failed += 1;
      }
      if (changes.length > 0) summary.changed += 1;
      const observation: ObservationRecord = { id: this.deps.newId(), sourceId: source.id, observedAt: now, status: page.status, contentHash: hash, offers, changes };
      await this.deps.store.addObservation(observation);
      await this.deps.store.saveSource({ ...source, lastCheckedAt: now, lastStatus: page.status });
      await this.audit(by, "source_read", source.id, { status: page.status, changes: changes.map((c) => c.code) });
    }
    return summary;
  }

  /** Owner report built from stored observations only. Nothing is estimated: missing reads show as missing. */
  async report(actor: Actor): Promise<SourceReport[]> {
    owner(actor);
    const sources = await this.deps.store.listSources({ activeOnly: false });
    const out: SourceReport[] = [];
    for (const source of sources) {
      const observations = await this.deps.store.listObservations(source.id, 30);
      const latest = observations[0] ?? null;
      const latestOk = observations.find((o) => o.status === "ok") ?? null;
      const lowest = new Map<string, number>();
      for (const o of latestOk?.offers ?? []) lowest.set(o.currency, Math.min(lowest.get(o.currency) ?? Infinity, o.amountMinor));
      out.push({
        source,
        latestStatus: latest?.status ?? null,
        latestObservedAt: latest?.observedAt ?? null,
        offerCount: latestOk?.offers.length ?? 0,
        lowestByCurrency: [...lowest].map(([currency, amountMinor]) => ({ currency, amountMinor })),
        changes: latest?.changes ?? [],
        opportunities: opportunitiesFrom(latest?.changes ?? []),
      });
    }
    return out;
  }

  private async audit(by: string, type: string, entityId: string, meta: Record<string, unknown>): Promise<void> {
    await this.deps.audit.write({ id: this.deps.newId(), ts: this.nowIso(), actor: `owner:${by}`, type: `competitor.${type}`, entityType: "competitor_source", entityId, meta });
  }
}
