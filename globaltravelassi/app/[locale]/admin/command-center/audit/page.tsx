import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, formatDateTime, type Locale } from "@/lib/i18n";
import { createServerSupabase } from "@/lib/supabase/server";
import { classifyLoadError, truncate } from "@/lib/ai/command-center/view";
import { DataTable, Panel } from "@/components/admin/AdminUI";
import { LoadState } from "@/components/admin/command-center/Parts";

export const metadata: Metadata = { title: "Audit logs", robots: { index: false, follow: false } };

type EventRow = {
  ts: string;
  actor: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  meta: unknown;
};

/** Newest first. The audit table is append-only and readable by administrators and operators under RLS. */
export default async function AuditPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const t = dict.commandCenter;

  const db = await createServerSupabase();
  const { data, error } = await db
    .from("ai_events")
    .select("ts, actor, event_type, entity_type, entity_id, meta")
    .order("ts", { ascending: false })
    .limit(100);
  if (error) return <LoadState kind={classifyLoadError(error.message)} dict={dict} />;

  const rows = (data ?? []) as EventRow[];

  return (
    <Panel title={t.auditTitle}>
      {rows.length === 0 ? (
        <p className="text-sm text-navy-600">{t.noEvents}</p>
      ) : (
        <DataTable head={[t.when, t.who, t.what, t.entity, t.details]}>
          {rows.map((row, index) => (
            <tr key={`${row.ts}-${index}`} className="align-top hover:bg-navy-50/50">
              <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(row.ts, locale)}</td>
              <td className="px-4 py-3 font-mono text-xs text-navy-700" dir="ltr">{truncate(row.actor, 60)}</td>
              <td className="px-4 py-3 font-mono text-xs font-semibold text-navy-900" dir="ltr">{row.event_type}</td>
              <td className="px-4 py-3 font-mono text-xs text-navy-700" dir="ltr">{truncate(`${row.entity_type} · ${row.entity_id}`, 60)}</td>
              <td className="px-4 py-3 font-mono text-xs text-navy-600" dir="ltr">{truncate(JSON.stringify(row.meta ?? {}), 160)}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </Panel>
  );
}
