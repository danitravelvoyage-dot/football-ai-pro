import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, formatDateTime, type Locale } from "@/lib/i18n";
import { loadCorrections } from "@/lib/ai/review/corrections-load";
import { DataTable, Panel } from "@/components/admin/AdminUI";
import { LoadState } from "@/components/admin/command-center/Parts";

export const metadata: Metadata = { title: "Corrections", robots: { index: false, follow: false } };

export default async function CorrectionsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const t = dict.commandCenter;
  const c = t.correctionsUi;

  const state = await loadCorrections();
  if (state.status === "unauthorized") return <p className="text-sm text-rose-800">{c.unauthorized}</p>;
  if (state.status !== "ok") return <LoadState kind={state.status} dict={dict} />;

  return (
    <>
      <p className="text-sm leading-relaxed text-navy-600">{c.hint}</p>
      <p className="rounded-2xl bg-navy-50 p-4 text-sm leading-relaxed text-navy-800">{c.note}</p>
      <Panel title={c.title}>
        {state.rows.length === 0 ? (
          <p className="text-sm text-navy-600">{c.none}</p>
        ) : (
          <DataTable head={[c.item, c.original, c.correction, c.who, c.when]}>
            {state.rows.map((row) => (
              <tr key={row.id} className="align-top hover:bg-navy-50/50">
                <td className="px-4 py-3">
                  <p className="font-semibold text-navy-900">{t.reviewUi.kind[row.kind as keyof typeof t.reviewUi.kind] ?? row.kind}</p>
                  <p dir="ltr" className="font-mono text-xs text-navy-600">{row.reviewId}</p>
                </td>
                <td className="px-4 py-3">
                  <p className="font-semibold text-navy-900">{t.reviewUi.status[row.originalStatus as keyof typeof t.reviewUi.status] ?? row.originalStatus}</p>
                  <p className="text-xs text-navy-600">{c.decidedBy}: <span dir="ltr" className="font-mono">{row.originalDecidedBy ?? "—"}</span></p>
                  <p className="text-xs text-navy-600">{c.decidedAt}: {formatDateTime(row.originalDecidedAt, locale)}</p>
                  <p className="text-xs text-navy-600">{c.reason}: {row.originalReason ?? "—"}</p>
                </td>
                <td className="px-4 py-3 text-navy-900">{row.correctionReason}</td>
                <td className="px-4 py-3 font-mono text-xs text-navy-700" dir="ltr">{row.actor}</td>
                <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(row.timestamp, locale)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
    </>
  );
}
