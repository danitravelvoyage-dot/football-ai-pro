import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, formatDateTime, type Locale } from "@/lib/i18n";
import { formMessages } from "@/lib/validation/messages";
import { loadInbox } from "@/lib/ai/notifications/load";
import { NOTICE_KINDS, type Severity, type NoticeKind } from "@/lib/ai/notifications/rules";
import { markNotificationReadAction } from "@/lib/actions/notifications";
import { ActionForm } from "@/components/forms/ActionForm";
import { generateDailyReportsAction } from "@/lib/actions/business";
import { SelectField } from "@/components/forms/Fields";
import { DataTable, Panel } from "@/components/admin/AdminUI";
import { LoadState } from "@/components/admin/command-center/Parts";
import { Badge } from "@/components/ui";

export const metadata: Metadata = { title: "Notifications", robots: { index: false, follow: false } };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const SEVERITIES: Severity[] = ["critical", "warning", "info"];
const TONE = { critical: "danger", warning: "warning", info: "info" } as const;

export default async function NotificationsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Search }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const n = dict.commandCenter.notificationsUi;
  const sp = await searchParams;

  const severity = SEVERITIES.find((s) => s === one(sp.severity));
  const kind = NOTICE_KINDS.find((k) => k === one(sp.kind));
  const unreadOnly = one(sp.unread) === "1";
  const state = await loadInbox({ severity, kind, unreadOnly, limit: 100 });

  if (state.status === "unauthorized") return <p className="text-sm text-rose-800">{n.unauthorized}</p>;
  if (state.status !== "ok") return <LoadState kind={state.status} dict={dict} />;

  const messages = { ...formMessages(dict), saved: n.saved, invalid_input: n.errorInvalid, forbidden: n.errorForbidden, unauthorized: n.errorUnauthorized, generic: n.errorGeneric };
  const kindLabel = (k: NoticeKind) => n.kinds[k];

  return (
    <>
      <p className="text-sm leading-relaxed text-navy-600">{n.hint}</p>
      <p className="text-sm text-navy-800">
        {n.unreadCount}: <span className="font-semibold">{state.unread}</span>
      </p>

      <Panel title={n.dailyReports}>
        <p className="mb-4 text-sm leading-relaxed text-navy-600">{n.dailyReportsHint}</p>
        <ActionForm action={generateDailyReportsAction} messages={{ ...formMessages(dict), saved: n.reportsPublished }} submitLabel={n.generateReports} pendingLabel={dict.common.loading} submitVariant="navy">
          <></>
        </ActionForm>
      </Panel>

      <Panel title={n.filters}>
        <form method="get" className="grid gap-4 sm:grid-cols-3">
          <SelectField name="severity" label={n.severity} defaultValue={severity ?? ""} options={[{ value: "", label: n.all }, ...SEVERITIES.map((s) => ({ value: s, label: n.severities[s] }))]} />
          <SelectField name="kind" label={n.kind} defaultValue={kind ?? ""} options={[{ value: "", label: n.all }, ...NOTICE_KINDS.map((k) => ({ value: k, label: kindLabel(k) }))]} />
          <label className="flex items-center gap-2 text-sm text-navy-800">
            <input type="checkbox" name="unread" value="1" defaultChecked={unreadOnly} className="h-4 w-4" />
            {n.unreadOnly}
          </label>
          <div className="sm:col-span-3">
            <button type="submit" className="rounded-full bg-navy-900 px-5 py-2 text-sm font-semibold text-white">{n.apply}</button>
          </div>
        </form>
      </Panel>

      <Panel title={n.inbox}>
        {state.items.length === 0 ? (
          <p className="text-sm text-navy-600">{n.empty}</p>
        ) : (
          <DataTable head={[n.when, n.severity, n.kind, n.message, n.status, ""]}>
            {state.items.map((item) => (
              <tr key={item.id} className="align-top hover:bg-navy-50/50">
                <td className="px-4 py-3 text-sm text-navy-800">{formatDateTime(item.createdAt, locale)}</td>
                <td className="px-4 py-3"><Badge tone={TONE[item.severity]}>{n.severities[item.severity]}</Badge></td>
                <td className="px-4 py-3 text-sm text-navy-800">{kindLabel(item.kind)}</td>
                <td className="px-4 py-3 text-sm text-navy-800">
                  <p className="font-semibold">{item.title}</p>
                  <p className="mt-1 text-navy-600">{item.body}</p>
                </td>
                <td className="px-4 py-3 text-sm">{item.readAt ? n.read : <Badge tone="gold">{n.unread}</Badge>}</td>
                <td className="px-4 py-3">
                  {item.readAt ? null : (
                    <ActionForm action={markNotificationReadAction} messages={messages} submitLabel={n.markRead} pendingLabel={dict.common.loading} submitVariant="navy">
                      <input type="hidden" name="id" value={item.id} />
                    </ActionForm>
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
    </>
  );
}
