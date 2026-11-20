import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, formatDateTime, type Locale } from "@/lib/i18n";
import { loadPlatform } from "@/lib/ai/command-center/platform-load";
import { deliveryTone, truncate } from "@/lib/ai/command-center/view";
import { Badge } from "@/components/ui";
import { DataTable, Panel } from "@/components/admin/AdminUI";
import { Fact, LoadState } from "@/components/admin/command-center/Parts";

export const metadata: Metadata = { title: "Event bus", robots: { index: false, follow: false } };

export default async function EventsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const t = dict.commandCenter;

  const state = await loadPlatform();
  if (state.status !== "ok") return <LoadState kind={state.status} dict={dict} />;
  const { events, deliveryCounts, deadLetters, retrying } = state;
  const typeById = new Map(events.map((e) => [e.id, e.eventType]));

  return (
    <>
      <p className="text-sm leading-relaxed text-navy-600">{t.eventsHint}</p>

      <Panel title={t.deliveriesTitle}>
        <dl className="grid grid-cols-3 gap-3">
          <Fact label={t.deliveredLabel} value={deliveryCounts.delivered} />
          <Fact label={t.queuedLabel} value={deliveryCounts.pending} />
          <Fact label={t.deadLabel} value={deliveryCounts.dead} />
        </dl>
      </Panel>

      <Panel title={t.recentEvents}>
        {events.length === 0 ? (
          <p className="text-sm text-navy-600">{t.noEvents}</p>
        ) : (
          <DataTable head={[t.occurred, t.eventType, t.producer, t.target, t.hops, t.details]}>
            {events.map((e) => (
              <tr key={e.id} className="align-top hover:bg-navy-50/50">
                <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(e.occurredAt, locale)}</td>
                <td className="px-4 py-3 font-mono text-xs font-semibold text-navy-900" dir="ltr">{e.eventType}</td>
                <td className="px-4 py-3 font-mono text-xs text-navy-700" dir="ltr">{e.producer}</td>
                <td className="px-4 py-3 font-mono text-xs text-navy-700" dir="ltr">{e.target}</td>
                <td className="px-4 py-3">{e.hopCount}</td>
                <td className="px-4 py-3 font-mono text-xs text-navy-600" dir="ltr">{truncate(JSON.stringify(e.payload ?? {}), 160)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <Panel title={t.deadLettersTitle}>
        {deadLetters.length === 0 ? (
          <p className="text-sm text-navy-600">{t.noDeadLetters}</p>
        ) : (
          <DataTable head={[t.occurred, t.eventType, t.agent, t.attempts, t.lastError]}>
            {deadLetters.map((d) => (
              <tr key={d.id} className="align-top hover:bg-navy-50/50">
                <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(d.createdAt, locale)}</td>
                <td className="px-4 py-3 font-mono text-xs text-navy-900" dir="ltr">{typeById.get(d.eventId) ?? "—"}</td>
                <td className="px-4 py-3 font-mono text-xs text-navy-700" dir="ltr">{d.subscriber}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <Badge tone={deliveryTone(d.status)}>{d.attempts} / {d.maxAttempts}</Badge>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-rose-800" dir="ltr">{d.lastError ? truncate(d.lastError, 160) : "—"}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <Panel title={t.retryTitle}>
        {retrying.length === 0 ? (
          <p className="text-sm text-navy-600">{t.noRetrying}</p>
        ) : (
          <DataTable head={[t.agent, t.attempts, t.nextAttempt, t.lastError]}>
            {retrying.map((d) => (
              <tr key={d.id} className="align-top hover:bg-navy-50/50">
                <td className="px-4 py-3 font-mono text-xs text-navy-700" dir="ltr">{d.subscriber}</td>
                <td className="px-4 py-3 whitespace-nowrap">{d.attempts} / {d.maxAttempts}</td>
                <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(d.nextAttemptAt, locale)}</td>
                <td className="px-4 py-3 font-mono text-xs text-rose-800" dir="ltr">{d.lastError ? truncate(d.lastError, 160) : "—"}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
    </>
  );
}
