import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import type {
  ApplicationRow, DocumentRow, EventRow, NoteRow, PaymentRow, ProfileRow, ServiceRow, ApplicationStatus,
} from "@/lib/domain";
import { applicationStatuses } from "@/lib/domain";

export type ApplicationListItem = ApplicationRow & {
  services: Pick<ServiceRow, "title_ar" | "title_fr" | "title_en" | "category" | "price" | "currency"> | null;
  profiles: Pick<ProfileRow, "full_name" | "email"> | null;
  payments?: { amount: string | number; currency: string; status: string }[];
};

const serviceFields = "services(title_ar, title_fr, title_en, category, price, currency)";

// ---------- Public catalogue ---------------------------------------------------

export async function getActiveServices(): Promise<ServiceRow[]> {
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

/**
 * The customer's own payments, through the customer_payments view: safe columns only. The owner's decision fields
 * (who decided, the internal reason, the proof file) are not read here.
 */
export async function getPaymentsFor(applicationId: string): Promise<PaymentRow[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("customer_payments")
    .select("id, application_id, amount, currency, method, status, reference, received_at, created_at, submitted_at, customer_visible_rejection_message")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: true });
  return (data ?? []) as PaymentRow[];
}

export async function getTimelineFor(applicationId: string): Promise<EventRow[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("application_events")
    .select("*")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: true });
  return (data ?? []) as EventRow[];
}

export async function getMyProfile(userId: string): Promise<ProfileRow | null> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  return (data as ProfileRow | null) ?? null;
}

// ---------- Admin -------------------------------------------------------------

export interface AdminOverview {
  total: number;
  newThisWeek: number;
  awaitingDocs: number;
  customers: number;
  receivedByCurrency: Record<string, number>;
  pendingPayments: number;
  byStatus: Record<ApplicationStatus, number>;
  recent: ApplicationListItem[];
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const supabase = await createServerSupabase();
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const [all, newWeek, customers, payments, recent] = await Promise.all([
    supabase.from("applications").select("status"),
    supabase.from("applications").select("id", { count: "exact", head: true }).gte("created_at", weekAgo),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "customer"),
    supabase.from("payments").select("amount, currency, status"),
    supabase.from("applications").select(`*, ${serviceFields}, profiles(full_name, email)`).order("created_at", { ascending: false }).limit(8),
  ]);

  const byStatus = Object.fromEntries(applicationStatuses.map((s) => [s, 0])) as Record<ApplicationStatus, number>;
  for (const row of (all.data ?? []) as { status: ApplicationStatus }[]) byStatus[row.status] += 1;

  const receivedByCurrency: Record<string, number> = {};
  let pendingPayments = 0;
  for (const p of (payments.data ?? []) as { amount: string | number; currency: string; status: string }[]) {
    if (p.status === "received") receivedByCurrency[p.currency] = (receivedByCurrency[p.currency] ?? 0) + Number(p.amount);
    if (p.status === "pending") pendingPayments += 1;
  }

  return {
    total: (all.data ?? []).length,
    newThisWeek: newWeek.count ?? 0,
    awaitingDocs: byStatus.documents_required,
    customers: customers.count ?? 0,
    receivedByCurrency,
    pendingPayments,
    byStatus,
    recent: (recent.data ?? []) as ApplicationListItem[],
  };
}

export interface ApplicationFilters {
  status?: string;
  q?: string;
}

export async function getAdminApplications(filters: ApplicationFilters): Promise<ApplicationListItem[]> {
  const supabase = await createServerSupabase();
  let query = supabase
    .from("applications")
    .select(`*, ${serviceFields}, profiles(full_name, email), payments(amount, currency, status)`)
    .order("created_at", { ascending: false })
    .limit(200);
  if (filters.status && (applicationStatuses as readonly string[]).includes(filters.status)) {
    query = query.eq("status", filters.status);
  }
  if (filters.q && filters.q.trim()) {
    const term = filters.q.trim().replace(/[%,()]/g, " ");
    query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%,reference.ilike.%${term}%`);
  }
  const { data, error } = await query;
  if (error) {
    console.error("getAdminApplications failed", error.code);
    return [];
  }
  return (data ?? []) as ApplicationListItem[];
}

export async function getAdminApplicationDetail(id: string) {
  const supabase = await createServerSupabase();
  const [app, docs, payments, notes, events] = await Promise.all([
    supabase.from("applications").select(`*, ${serviceFields}, profiles(id, full_name, email, whatsapp, is_active)`).eq("id", id).maybeSingle(),
    supabase.from("documents").select("*").eq("application_id", id).order("created_at", { ascending: true }),
    supabase.from("payments").select("*").eq("application_id", id).order("created_at", { ascending: true }),
    supabase.from("application_notes").select("*").eq("application_id", id).order("created_at", { ascending: false }),
    supabase.from("application_events").select("*").eq("application_id", id).order("created_at", { ascending: true }),
  ]);
  return {
    application: (app.data as (ApplicationListItem & { profiles: (ProfileRow & { is_active: boolean }) | null }) | null) ?? null,
    documents: (docs.data ?? []) as DocumentRow[],
    payments: (payments.data ?? []) as PaymentRow[],
    notes: (notes.data ?? []) as NoteRow[],
    events: (events.data ?? []) as EventRow[],
  };
}

export async function getAdminCustomers(): Promise<(ProfileRow & { requestCount: number })[]> {
  const supabase = await createServerSupabase();
  const [profiles, apps] = await Promise.all([
    supabase.from("profiles").select("*").order("created_at", { ascending: false }).limit(500),
    supabase.from("applications").select("user_id"),
  ]);
  const counts = new Map<string, number>();
  for (const row of (apps.data ?? []) as { user_id: string }[]) counts.set(row.user_id, (counts.get(row.user_id) ?? 0) + 1);
  return ((profiles.data ?? []) as ProfileRow[]).map((p) => ({ ...p, requestCount: counts.get(p.id) ?? 0 }));
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

export interface ReportData {
  byMonth: { month: string; requests: number; received: Record<string, number> }[];
  byStatus: Record<ApplicationStatus, number>;
  byService: { title: string; requests: number }[];
  receivedByCurrency: Record<string, number>;
}

export async function getReportData(): Promise<ReportData> {
  const supabase = await createServerSupabase();
  const [apps, payments, services] = await Promise.all([
    supabase.from("applications").select("created_at, status, service_id"),
    supabase.from("payments").select("amount, currency, status, received_at"),
    supabase.from("services").select("id, title_en"),
  ]);
  const monthKey = (iso: string) => iso.slice(0, 7);
  const byMonth = new Map<string, ReportData["byMonth"][number]>();
  const ensure = (m: string) => {
    if (!byMonth.has(m)) byMonth.set(m, { month: m, requests: 0, received: {} });
    return byMonth.get(m)!;
  };
  const byStatus = Object.fromEntries(applicationStatuses.map((s) => [s, 0])) as Record<ApplicationStatus, number>;
  const serviceTitles = new Map(((services.data ?? []) as { id: string; title_en: string }[]).map((s) => [s.id, s.title_en]));
  const byServiceCount = new Map<string, number>();

  for (const a of (apps.data ?? []) as { created_at: string; status: ApplicationStatus; service_id: string }[]) {
    ensure(monthKey(a.created_at)).requests += 1;
    byStatus[a.status] += 1;
    const title = serviceTitles.get(a.service_id) ?? "—";
    byServiceCount.set(title, (byServiceCount.get(title) ?? 0) + 1);
  }
  const receivedByCurrency: Record<string, number> = {};
  for (const p of (payments.data ?? []) as { amount: string | number; currency: string; status: string; received_at: string | null }[]) {
    if (p.status !== "received" || !p.received_at) continue;
    const bucket = ensure(monthKey(p.received_at));
    bucket.received[p.currency] = (bucket.received[p.currency] ?? 0) + Number(p.amount);
    receivedByCurrency[p.currency] = (receivedByCurrency[p.currency] ?? 0) + Number(p.amount);
  }
  return {
    byMonth: [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month)),
    byStatus,
    byService: [...byServiceCount.entries()].map(([title, requests]) => ({ title, requests })).sort((a, b) => b.requests - a.requests),
    receivedByCurrency,
  };
}

export async function getExportRows() {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("applications")
    .select(`reference, full_name, email, whatsapp, nationality, destination_country, status, source, created_at, ${serviceFields}, payments(amount, currency, status, received_at)`)
    .order("created_at", { ascending: false })
    .limit(5000);
  return data ?? [];
}
