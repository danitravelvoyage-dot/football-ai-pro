import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, formatDateTime, type Locale } from "@/lib/i18n";
import { loadPlatform } from "@/lib/ai/command-center/platform-load";
import { previewJson, truncate } from "@/lib/ai/command-center/view";
import { DataTable, Panel } from "@/components/admin/AdminUI";
import { LoadState } from "@/components/admin/command-center/Parts";

export const metadata: Metadata = { title: "Shared context", robots: { index: false, follow: false } };

export default async function ContextPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const t = dict.commandCenter;

  const state = await loadPlatform();
  if (state.status !== "ok") return <LoadState kind={state.status} dict={dict} />;
  const { context } = state;

  return (
    <Panel title={t.contextTitle}>
      <p className="mb-6 text-sm leading-relaxed text-navy-600">{t.contextHint}</p>
      {context.length === 0 ? (
        <p className="text-sm text-navy-600">{t.noContext}</p>
      ) : (
        <DataTable head={[t.scope, t.contextKey, t.version, t.visibility, t.updatedBy, t.updatedAt, t.contextValue]}>
          {context.map((e) => (
            <tr key={e.id} className="align-top hover:bg-navy-50/50">
              <td className="px-4 py-3 text-sm text-navy-900">
                <span className="font-semibold">{t.scopeLabels[e.scope]}</span>
                <span className="mt-1 block font-mono text-xs text-navy-500" dir="ltr">{truncate(e.scopeKey, 40)}</span>
              </td>
              <td className="px-4 py-3 font-mono text-xs text-navy-800" dir="ltr">{e.contextKey}</td>
              <td className="px-4 py-3 whitespace-nowrap">{e.version}</td>
              <td className="px-4 py-3 text-sm text-navy-700">{t.visibilityLabels[e.visibility]}</td>
              <td className="px-4 py-3 font-mono text-xs text-navy-700" dir="ltr">{truncate(e.updatedBy, 60)}</td>
              <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(e.updatedAt, locale)}</td>
              <td className="px-4 py-3">
                <pre dir="ltr" className="max-h-40 max-w-md overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-navy-800">
                  {previewJson(e.value, 400)}
                </pre>
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </Panel>
  );
}
