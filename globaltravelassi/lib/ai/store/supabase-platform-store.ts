import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ContextForbiddenError } from "../context/service";
import { ContextVersionConflictError, type ContextEntry, type ContextStore, type ContextVersion, type ContextWrite } from "../context/store";
import type { ContextScope, ContextVisibility } from "../context/policy";
import { KbVersionConflictError, type KbFilter, type KbStore } from "../knowledge/store";
import type { KbCategory, KbEntry, KbEntryInput, ReliabilityStatus } from "../knowledge/rules";
import type { Country, Language } from "../types";

type Row = Record<string, unknown>;

function fail(error: { message: string } | null): never {
  throw new Error(error?.message ?? "Database error.");
}

function toContext(row: Row): ContextEntry {
  return {
    id: row.id as string,
    scope: row.scope as ContextScope,
    scopeKey: row.scope_key as string,
    contextKey: row.context_key as string,
    value: row.value,
    visibility: row.visibility as ContextVisibility,
    version: row.version as number,
    updatedBy: row.updated_by as string,
    updatedAt: row.updated_at as string,
  };
}

function toKb(row: Row): KbEntry {
  return {
    id: row.id as string,
    category: row.category as KbCategory,
    slug: row.slug as string,
    language: row.language as Language,
    country: row.country as Country,
    title: row.title as string,
    body: row.body as string,
    officialSourceUrl: (row.official_source_url as string | null) ?? null,
    verifiedAt: (row.verified_at as string | null) ?? null,
    reliabilityStatus: row.reliability_status as ReliabilityStatus,
    version: row.version as number,
    createdBy: row.created_by as string,
    updatedAt: row.updated_at as string,
  };
}

/** Shared context on ai_context_entries and ai_context_versions. Writes go through the atomic ai_context_write function. */
export class SupabaseContextStore implements ContextStore {
  constructor(private readonly db: SupabaseClient) {}

  async list(filter: { scope?: ContextScope; scopeKey?: string; limit: number }) {
    let query = this.db.from("ai_context_entries").select("*").order("updated_at", { ascending: false }).order("id", { ascending: false }).limit(filter.limit);
    if (filter.scope) query = query.eq("scope", filter.scope);
    if (filter.scopeKey) query = query.eq("scope_key", filter.scopeKey);
    const { data, error } = await query;
    if (error) fail(error);
    return ((data ?? []) as Row[]).map(toContext);
  }

  async get(scope: ContextScope, scopeKey: string, contextKey: string) {
    const { data, error } = await this.db.from("ai_context_entries").select("*").eq("scope", scope).eq("scope_key", scopeKey).eq("context_key", contextKey).maybeSingle();
    if (error) fail(error);
    return data ? toContext(data as Row) : null;
  }

  async write(w: ContextWrite) {
    const { data, error } = await this.db.rpc("ai_context_write", {
      p_scope: w.scope,
      p_scope_key: w.scopeKey,
      p_key: w.contextKey,
      p_value: w.value,
      p_expected_version: w.expectedVersion,
      p_visibility: w.visibility,
      p_changed_by: w.changedBy,
      p_reason: w.reason,
    });
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "40001") throw new ContextVersionConflictError();
      if (code === "42501") throw new ContextForbiddenError();
      fail(error);
    }
    const row = ((data ?? []) as Row[])[0];
    if (!row) throw new Error("Context write returned no row.");
    return { entryId: row.out_entry_id as string, version: row.out_version as number };
  }

  async history(entryId: string, limit: number): Promise<ContextVersion[]> {
    const { data, error } = await this.db
      .from("ai_context_versions")
      .select("entry_id, version, value, changed_by, reason, changed_at")
      .eq("entry_id", entryId)
      .order("version", { ascending: false })
      .limit(limit);
    if (error) fail(error);
    return ((data ?? []) as Row[]).map((r) => ({
      entryId: r.entry_id as string,
      version: r.version as number,
      value: r.value,
      changedBy: r.changed_by as string,
      reason: (r.reason as string | null) ?? null,
      changedAt: r.changed_at as string,
    }));
  }
}

/** Knowledge base on ai_kb_entries. Row-level security limits writes to the owner. */
export class SupabaseKbStore implements KbStore {
  constructor(private readonly db: SupabaseClient) {}

  async list(filter: KbFilter) {
    let query = this.db.from("ai_kb_entries").select("*").order("updated_at", { ascending: false }).order("slug", { ascending: true }).limit(filter.limit);
    if (filter.category) query = query.eq("category", filter.category);
    if (filter.country) query = query.eq("country", filter.country);
    if (filter.language) query = query.eq("language", filter.language);
    if (filter.reliability) query = query.eq("reliability_status", filter.reliability);
    const { data, error } = await query;
    if (error) fail(error);
    return ((data ?? []) as Row[]).map(toKb);
  }

  async get(id: string) {
    const { data, error } = await this.db.from("ai_kb_entries").select("*").eq("id", id).maybeSingle();
    if (error) fail(error);
    return data ? toKb(data as Row) : null;
  }

  async findByKey(category: KbCategory, slug: string, language: Language, country: Country) {
    const { data, error } = await this.db
      .from("ai_kb_entries")
      .select("*")
      .eq("category", category)
      .eq("slug", slug)
      .eq("language", language)
      .eq("country", country)
      .maybeSingle();
    if (error) fail(error);
    return data ? toKb(data as Row) : null;
  }

  private toRow(entry: KbEntryInput) {
    return {
      category: entry.category,
      slug: entry.slug,
      language: entry.language,
      country: entry.country,
      title: entry.title,
      body: entry.body,
      official_source_url: entry.officialSourceUrl,
      verified_at: entry.verifiedAt,
      reliability_status: entry.reliabilityStatus,
    };
  }

  async insert(entry: KbEntryInput, createdBy: string, updatedAt: string) {
    const { data, error } = await this.db
      .from("ai_kb_entries")
      .insert({ ...this.toRow(entry), version: 1, created_by: createdBy, updated_at: updatedAt })
      .select("*")
      .single();
    if (error) fail(error);
    return toKb(data as Row);
  }

  async update(id: string, expectedVersion: number, patch: Partial<KbEntryInput>, updatedAt: string) {
    const changes: Row = { version: expectedVersion + 1, updated_at: updatedAt };
    if (patch.title !== undefined) changes.title = patch.title;
    if (patch.body !== undefined) changes.body = patch.body;
    if (patch.officialSourceUrl !== undefined) changes.official_source_url = patch.officialSourceUrl;
    if (patch.verifiedAt !== undefined) changes.verified_at = patch.verifiedAt;
    if (patch.reliabilityStatus !== undefined) changes.reliability_status = patch.reliabilityStatus;
    const { data, error } = await this.db
      .from("ai_kb_entries")
      .update(changes)
      .eq("id", id)
      .eq("version", expectedVersion)
      .select("*")
      .maybeSingle();
    if (error) fail(error);
    if (!data) throw new KbVersionConflictError();
    return toKb(data as Row);
  }
}
