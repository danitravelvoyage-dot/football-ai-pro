import type { AuditSink } from "../audit";
import { assertNoPersonalData, PersonalDataError } from "../security/personal-data";
import { getAgent } from "../registry";
import { assertToolAllowed, ToolPermissionError } from "../tools";
import type { Actor, AgentKey } from "../types";
import { kbEntryInputSchema, selectForAgent, toAgentFact, type KbEntry, type KbEntryInput, type ReliabilityStatus } from "./rules";
import type { KbStore } from "./store";

/** Largest knowledge base an agent query will scan. Beyond this the query fails rather than returning partial facts. */
export const KB_SCAN_LIMIT = 1000;

export class KbForbiddenError extends Error {
  constructor() {
    super("Only the owner can change the knowledge base.");
    this.name = "KbForbiddenError";
  }
}

export class KbValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KbValidationError";
  }
}

export interface KbServiceDeps {
  store: KbStore;
  audit: AuditSink;
  now: () => Date;
  newId: () => string;
}

/**
 * Knowledge base. The owner writes; the owner and the runner read. Agents receive only current,
 * verified facts, and only when their role includes the knowledge-read tool.
 */
export class KbService {
  constructor(private readonly deps: KbServiceDeps) {}

  private async audit(actor: Actor, type: string, entityId: string, meta: Record<string, unknown>) {
    const label = actor.kind === "owner" ? `owner:${actor.id}` : actor.kind === "agent" ? `agent:${actor.agent}` : "system";
    await this.deps.audit.write({ id: this.deps.newId(), ts: this.deps.now().toISOString(), actor: label, type, entityType: "kb_entry", entityId, meta });
  }

  private parse(input: unknown): KbEntryInput {
    const parsed = kbEntryInputSchema.safeParse(input);
    if (!parsed.success) throw new KbValidationError(parsed.error.issues[0]?.message ?? "Entry is invalid.");
    const v = parsed.data;
    if (v.verifiedAt && Date.parse(v.verifiedAt) > this.deps.now().getTime() + 60_000) {
      throw new KbValidationError("The verification date cannot be in the future.");
    }
    try {
      assertNoPersonalData({ title: v.title, body: v.body });
    } catch (error) {
      if (error instanceof PersonalDataError) throw new KbValidationError("The entry contains personal data and was refused.");
      throw error;
    }
    return v;
  }

  /** Creates the entry, or replaces the content of the entry with the same category, slug, language and country. */
  async save(actor: Actor, input: unknown): Promise<KbEntry> {
    if (actor.kind !== "owner") throw new KbForbiddenError();
    const v = this.parse(input);
    const now = this.deps.now().toISOString();
    const existing = await this.deps.store.findByKey(v.category, v.slug, v.language, v.country);
    if (!existing) {
      const created = await this.deps.store.insert(v, `owner:${actor.id}`, now);
      await this.audit(actor, "kb.created", created.id, { category: v.category, reliability: v.reliabilityStatus });
      return created;
    }
    const updated = await this.deps.store.update(existing.id, existing.version, v, now);
    await this.audit(actor, "kb.updated", updated.id, { category: v.category, version: updated.version, reliability: v.reliabilityStatus });
    return updated;
  }

  /** The owner records a review outcome. Verifying sets the date to now. Disputing or retiring removes the entry from agent use. */
  async review(actor: Actor, id: string, action: "verify_official" | "verify_internal" | "dispute" | "retire", sourceUrl: string | null): Promise<KbEntry> {
    if (actor.kind !== "owner") throw new KbForbiddenError();
    const current = await this.deps.store.get(id);
    if (!current) throw new KbValidationError("Entry not found.");
    const statusFor: Record<typeof action, ReliabilityStatus> = {
      verify_official: "verified_official",
      verify_internal: "verified_internal",
      dispute: "disputed",
      retire: "retired",
    };
    const reliabilityStatus = statusFor[action];
    const verifiedAt = reliabilityStatus.startsWith("verified_") ? this.deps.now().toISOString() : current.verifiedAt;
    const officialSourceUrl = sourceUrl ?? current.officialSourceUrl;
    const candidate = { ...current, reliabilityStatus, verifiedAt, officialSourceUrl };
    this.parse(candidate);
    const updated = await this.deps.store.update(
      id,
      current.version,
      { reliabilityStatus, verifiedAt, officialSourceUrl },
      this.deps.now().toISOString(),
    );
    await this.audit(actor, "kb.reviewed", id, { action, reliability: reliabilityStatus });
    return updated;
  }

  /** What an agent may use. Refused unless the agent's role includes the knowledge-read tool. */
  async forAgent(agent: AgentKey, query: { country: KbEntry["country"]; language: KbEntry["language"]; categories?: KbEntry["category"][]; limit?: number }) {
    try {
      assertToolAllowed(agent, "store.readKnowledge", getAgent(agent).tools);
    } catch (error) {
      if (error instanceof ToolPermissionError) return [];
      throw error;
    }
    const rows = await this.deps.store.list({ limit: KB_SCAN_LIMIT });
    if (rows.length >= KB_SCAN_LIMIT) throw new KbValidationError("The knowledge base is too large to scan for one agent query.");
    return selectForAgent(rows, query, this.deps.now()).map(toAgentFact);
  }
}
