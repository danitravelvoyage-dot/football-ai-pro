import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import type {
  ApplicationRow, DocumentRow, EventRow, NoteRow, ProfileRow, ServiceRow, ApplicationStatus,
} from "@/lib/domain";
import { applicationStatuses, leadSources, normalizeStatus } from "@/lib/domain";
import { isSupabaseConfigured } from "@/lib/config";
import { pageInfo, pageRange, searchTerm, type PageInfo } from "@/lib/pagination";

export type ApplicationListItem = ApplicationRow & {
  services: Pick<ServiceRow, "title_ar" | "title_fr" | "title_en" | "category" | "price" | "currency"> | null;
  profiles: Pick<ProfileRow, "full_name" | "email"> | null;
};

export interface CrmActivityRow {
  id: string;
  kind: string;
  detail: string;
  created_at: string;
}

const serviceFields = "services(title_ar, title_fr, title_en, category, price, currency)";

// ---------- Public catalogue ---------------------------------------------------

export async function getActiveServices(): Promise<ServiceRow[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("services")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("getActiveServices failed", error.code);
    return [];
  }
  return (data ?? []) as ServiceRow[];
}

/**
 * A service page's data source. "inactive" means the owner hid it: the page must not be shown. "missing" and
 * "unavailable" (no database configured, or a read failed) fall back to the seed copy in lib/services-content.ts.
 */
export type ServiceLookup =
  | { state: "active"; row: ServiceRow }
  | { state: "inactive" }
  | { state: "missing" }
  | { state: "unavailable" };

export async function findServiceBySlug(slug: string): Promise<ServiceLookup> {
  if (!isSupabaseConfigured()) return { state: "unavailable" };
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("services").select("*").eq("slug", slug).maybeSingle();
  if (error) return { state: "unavailable" };
  if (!data) return { state: "missing" };
  const row = data as ServiceRow;
  return row.is_active ? { state: "active", row } : { state: "inactive" };
}

export async function getServiceBySlug(slug: string): Promise<ServiceRow | null> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("services").select("*").eq("slug", slug).eq("is_active", true).maybeSingle();
  return (data as ServiceRow | null) ?? null;
}

// ---------- Customer ----------------------------------------------------------

export async function getMyApplications(): Promise<ApplicationListItem[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("applications")
    .select(`*, ${serviceFields}`)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("getMyApplications failed", error.code);
    return [];
  }
  return (data ?? []) as ApplicationListItem[];
}

export async function getApplicationWithService(id: string): Promise<ApplicationListItem | null> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("applications").select(`*, ${serviceFields}, profiles(full_name, email)`).eq("id", id).maybeSingle();
  return (data as ApplicationListItem | null) ?? null;
}

export async function getDocumentsFor(applicationId: string): Promise<DocumentRow[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("documents")
    .select("*")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: true });
  return (data ?? []) as DocumentRow[];
}

export async function getTimelineFor(applicationId: string): Promise<EventRow[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("customer_application_events")
    .select("id, application_id, kind, to_status, message, created_at")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: true });
  return (data ?? []) as EventRow[];
}

export async function getMyProfile(userId: string): Promise<ProfileRow | null> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  return (data as ProfileRow | null) ?? null;
}

// ---------- Admin: overview and statistics -----------------------------------

export type StatusGroup = "new" | "pending" | "in_progress" | "approved" | "rejected";

/** The five groups the owner works with. Each request status belongs to exactly one group. */
export const statusGroups: Record<ApplicationStatus, StatusGroup> = {
  new: "new",
  documents_required: "pending",
  submitted: "pending",
  in_review: "in_progress",
  approved: "approved",
  completed: "approved",
  rejected: "rejected",
  cancelled: "rejected",
};

export interface AdminOverview {
  total: number;
  newThisWeek: number;
  customers: number;
  groups: Record<StatusGroup, number>;
  byStatus: Record<ApplicationStatus, number>;
  byService: { title: string; count: number }[];
  byLocale: Record<string, number>;
  byLeadSource: Record<string, number>;
  recent: ApplicationListItem[];
  newRequests: ApplicationListItem[];
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const supabase = await createServerSupabase();
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const [all, newWeek, customers, services, recent, newest] = await Promise.all([
    supabase.from("applications").select(`status, service_id, locale, lead_source`),
    supabase.from("applications").select("id", { count: "exact", head: true }).gte("created_at", weekAgo),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "customer"),
    supabase.from("services").select("id, title_en"),
    supabase.from("applications").select(`*, ${serviceFields}, profiles(full_name, email)`).order("created_at", { ascending: false }).limit(8),
    supabase.from("applications").select(`*, ${serviceFields}, profiles(full_name, email)`).eq("status", "new").order("created_at", { ascending: false }).limit(10),
  ]);

  const rows = (all.data ?? []) as { status: string; service_id: string; locale: string; lead_source: string | null }[];
  const byStatus = Object.fromEntries(applicationStatuses.map((s) => [s, 0])) as Record<ApplicationStatus, number>;
  const groups: Record<StatusGroup, number> = { new: 0, pending: 0, in_progress: 0, approved: 0, rejected: 0 };
  const titles = new Map(((services.data ?? []) as { id: string; title_en: string }[]).map((s) => [s.id, s.title_en]));
  const serviceCounts = new Map<string, number>();
  const byLocale: Record<string, number> = {};
  const byLeadSource: Record<string, number> = { not_recorded: 0 };
  for (const s of leadSources) byLeadSource[s] = 0;

  for (const r of rows) {
    const status = normalizeStatus(r.status);
    byStatus[status] += 1;
    groups[statusGroups[status]] += 1;
    const title = titles.get(r.service_id) ?? "—";
    serviceCounts.set(title, (serviceCounts.get(title) ?? 0) + 1);
    byLocale[r.locale] = (byLocale[r.locale] ?? 0) + 1;
    const source = r.lead_source ?? "not_recorded";
    byLeadSource[source] = (byLeadSource[source] ?? 0) + 1;
  }

  return {
    total: rows.length,
    newThisWeek: newWeek.count ?? 0,
    customers: customers.count ?? 0,
    groups,
    byStatus,
    byService: [...serviceCounts.entries()].map(([title, count]) => ({ title, count })).sort((a, b) => b.count - a.count),
    byLocale,
    byLeadSource,
    recent: (recent.data ?? []) as ApplicationListItem[],
    newRequests: (newest.data ?? []) as ApplicationListItem[],
  };
}

// ---------- Admin: requests --------------------------------------------------

export interface ApplicationFilters {
  status?: string;
  group?: string;
  source?: string;
  locale?: string;
  category?: string;
  q?: string;
}

/** A request in the admin list, with its documents' types: enough to compute the lead priority and checklist. */
export type AdminApplicationListItem = ApplicationListItem & { documents: Pick<DocumentRow, "doc_type" | "verified">[] | null };

export async function getAdminApplications(
  filters: ApplicationFilters,
  page = 1,
): Promise<{ rows: AdminApplicationListItem[]; info: PageInfo }> {
  const supabase = await createServerSupabase();
  const { from, to } = pageRange(page);
  let query = supabase
    .from("applications")
    .select(`*, ${serviceFields}, profiles(full_name, email), documents(doc_type, verified)`, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (filters.status && (applicationStatuses as readonly string[]).includes(filters.status)) {
    query = query.eq("status", filters.status);
  } else if (filters.group) {
    const members = (Object.keys(statusGroups) as ApplicationStatus[]).filter((s) => statusGroups[s] === filters.group);
    if (members.length) query = query.in("status", members);
  }
  if (filters.source === "not_recorded") query = query.is("lead_source", null);
  else if (filters.source && (leadSources as readonly string[]).includes(filters.source)) query = query.eq("lead_source", filters.source);
  if (filters.locale && ["ar", "fr", "en"].includes(filters.locale)) query = query.eq("locale", filters.locale);
  if (filters.category && ["standard", "priority", "returning", "corporate"].includes(filters.category)) query = query.eq("customer_category", filters.category);
  const term = searchTerm(filters.q);
  if (term) {
    query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%,reference.ilike.%${term}%`);
  }
  const { data, error, count } = await query;
  if (error) {
    console.error("getAdminApplications failed", error.code);
    return { rows: [], info: pageInfo(page, 0, 0) };
  }
  const rows = (data ?? []) as AdminApplicationListItem[];
  return { rows, info: pageInfo(page, count ?? rows.length, rows.length) };
}

export async function getAdminApplicationDetail(id: string) {
  const supabase = await createServerSupabase();
  const [app, docs, notes, events, activity] = await Promise.all([
    supabase.from("applications").select(`*, ${serviceFields}, profiles(id, full_name, email, whatsapp, is_active)`).eq("id", id).maybeSingle(),
    supabase.from("documents").select("*").eq("application_id", id).order("created_at", { ascending: true }),
    supabase.from("application_notes").select("*").eq("application_id", id).order("created_at", { ascending: false }),
    supabase.from("application_events").select("*").eq("application_id", id).neq("kind", "payment").order("created_at", { ascending: true }),
    supabase.from("crm_activity").select("id, kind, detail, created_at").eq("application_id", id).order("created_at", { ascending: false }).limit(50),
  ]);
  const application = (app.data as (ApplicationListItem & { profiles: (ProfileRow & { is_active: boolean }) | null }) | null) ?? null;
  const history = application
    ? await supabase
        .from("applications")
        .select("id, reference, status, created_at, service_id")
        .eq("user_id", application.user_id)
        .neq("id", id)
        .order("created_at", { ascending: false })
        .limit(50)
    : { data: [] };
  return {
    application,
    documents: (docs.data ?? []) as DocumentRow[],
    notes: (notes.data ?? []) as NoteRow[],
    events: (events.data ?? []) as EventRow[],
    activity: (activity.data ?? []) as CrmActivityRow[],
    history: (history.data ?? []) as { id: string; reference: string; status: string; created_at: string; service_id: string }[],
  };
}

// ---------- Admin: customers -------------------------------------------------

export async function getAdminCustomers(
  options: { q?: string; page?: number } = {},
): Promise<{ rows: (ProfileRow & { requestCount: number; sources: string[] })[]; info: PageInfo }> {
  const supabase = await createServerSupabase();
  const page = options.page ?? 1;
  const { from, to } = pageRange(page);
  let profileQuery = supabase.from("profiles").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(from, to);
  const term = searchTerm(options.q);
  if (term) profileQuery = profileQuery.or(`full_name.ilike.%${term}%,email.ilike.%${term}%,whatsapp.ilike.%${term}%`);
  const profiles = await profileQuery;
  const pageRows = (profiles.data ?? []) as ProfileRow[];
  // Request counts for the customers on this page only.
  const apps = pageRows.length
    ? await supabase.from("applications").select("user_id, lead_source").in("user_id", pageRows.map((p) => p.id)).limit(5000)
    : { data: [] };
  const counts = new Map<string, number>();
  const sources = new Map<string, Set<string>>();
  for (const row of (apps.data ?? []) as { user_id: string; lead_source: string | null }[]) {
    counts.set(row.user_id, (counts.get(row.user_id) ?? 0) + 1);
    if (row.lead_source) {
      if (!sources.has(row.user_id)) sources.set(row.user_id, new Set());
      sources.get(row.user_id)!.add(row.lead_source);
    }
  }
  const rows = pageRows.map((p) => ({
    ...p,
    requestCount: counts.get(p.id) ?? 0,
    sources: [...(sources.get(p.id) ?? [])],
  }));
  if (profiles.error) console.error("getAdminCustomers failed", profiles.error.code);
  return { rows, info: pageInfo(page, profiles.count ?? rows.length, rows.length) };
}

/** Customers counted by the lead source of their requests. A customer with requests from two sources counts in both. */
export async function getCustomerCountsBySource(): Promise<Record<string, number>> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("applications").select("user_id, lead_source").limit(5000);
  const seen = new Map<string, Set<string>>();
  for (const row of (data ?? []) as { user_id: string; lead_source: string | null }[]) {
    const key = row.lead_source ?? "not_recorded";
    if (!seen.has(key)) seen.set(key, new Set());
    seen.get(key)!.add(row.user_id);
  }
  return Object.fromEntries([...seen.entries()].map(([k, v]) => [k, v.size]));
}

export async function getAdminServices(): Promise<ServiceRow[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("services").select("*").order("sort_order", { ascending: true });
  return (data ?? []) as ServiceRow[];
}

export async function getAdminService(id: string): Promise<ServiceRow | null> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("services").select("*").eq("id", id).maybeSingle();
  return (data as ServiceRow | null) ?? null;
}

// ---------- Admin: reports and export -----------------------------------------

export interface ReportData {
  byMonth: { month: string; requests: number }[];
  byStatus: Record<ApplicationStatus, number>;
  byService: { title: string; requests: number }[];
  byLocale: Record<string, number>;
  bySource: Record<string, number>;
}

export async function getReportData(): Promise<ReportData> {
  const supabase = await createServerSupabase();
  const [apps, services] = await Promise.all([
    supabase.from("applications").select("created_at, status, service_id, locale, lead_source"),
    supabase.from("services").select("id, title_en"),
  ]);
  const byMonth = new Map<string, number>();
  const byStatus = Object.fromEntries(applicationStatuses.map((s) => [s, 0])) as Record<ApplicationStatus, number>;
  const serviceTitles = new Map(((services.data ?? []) as { id: string; title_en: string }[]).map((s) => [s.id, s.title_en]));
  const byServiceCount = new Map<string, number>();
  const byLocale: Record<string, number> = {};
  const bySource: Record<string, number> = {};

  for (const a of (apps.data ?? []) as { created_at: string; status: string; service_id: string; locale: string; lead_source: string | null }[]) {
    const month = a.created_at.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
    byStatus[normalizeStatus(a.status)] += 1;
    const title = serviceTitles.get(a.service_id) ?? "—";
    byServiceCount.set(title, (byServiceCount.get(title) ?? 0) + 1);
    byLocale[a.locale] = (byLocale[a.locale] ?? 0) + 1;
    const source = a.lead_source ?? "not_recorded";
    bySource[source] = (bySource[source] ?? 0) + 1;
  }
  return {
    byMonth: [...byMonth.entries()].map(([month, requests]) => ({ month, requests })).sort((a, b) => b.month.localeCompare(a.month)),
    byStatus,
    byService: [...byServiceCount.entries()].map(([title, requests]) => ({ title, requests })).sort((a, b) => b.requests - a.requests),
    byLocale,
    bySource,
  };
}

export async function getExportRows() {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("applications")
    .select(`reference, full_name, email, whatsapp, nationality, destination_country, status, source, lead_source, lead_source_detail, customer_category, locale, last_contacted_at, created_at, ${serviceFields}`)
    .order("created_at", { ascending: false })
    .limit(5000);
  return data ?? [];
}

// ---------- Admin: customer email log (migration 0021) -------------------------

export interface CustomerEmailLogRow {
  id: string;
  kind: string;
  application_id: string | null;
  recipient: string;
  locale: string;
  status: "pending" | "sent" | "failed" | "skipped";
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
  template_data: { reference?: string } | null;
}

/** The latest customer emails, newest first. */
export async function getCustomerEmailLog(options: { applicationId?: string; limit?: number } = {}): Promise<CustomerEmailLogRow[]> {
  const supabase = await createServerSupabase();
  let query = supabase
    .from("customer_email_notifications")
    .select("id, kind, application_id, recipient, locale, status, attempts, last_error, created_at, sent_at, template_data")
    .not("kind", "like", "payment_%")
    .order("created_at", { ascending: false })
    .limit(Math.min(options.limit ?? 100, 200));
  if (options.applicationId) query = query.eq("application_id", options.applicationId);
  const { data, error } = await query;
  if (error) return [];
  return (data ?? []) as CustomerEmailLogRow[];
}
