import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, formatDateTime, type Locale } from "@/lib/i18n";
import { loadPlatform } from "@/lib/ai/command-center/platform-load";
import { freshnessTone, safeHttpsUrl, truncate } from "@/lib/ai/command-center/view";
import { freshnessOf } from "@/lib/ai/knowledge/rules";
import { Badge } from "@/components/ui";
import { DataTable, Panel } from "@/components/admin/AdminUI";
import { LoadState } from "@/components/admin/command-center/Parts";

export const metadata: Metadata = { title: "Knowledge base", robots: { index: false, follow: false } };

export default async function KnowledgePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const t = dict.commandCenter;

  const state = await loadPlatform();
  if (state.status !== "ok") return <LoadState kind={state.status} dict={dict} />;
  const now = new Date();

  return (
    <Panel title={t.knowledgeTitle}>
      <p className="mb-6 text-sm leading-relaxed text-navy-600">{t.knowledgeHint}</p>
      {state.knowledge.length === 0 ? (
        <p className="text-sm text-navy-600">{t.noKnowledge}</p>
      ) : (
        <DataTable head={[t.category, t.itemTitle, t.country, t.language, t.reliability, t.freshness, t.verifiedAt, t.sourceLink]}>
          {state.knowledge.map((entry) => {
            const freshness = freshnessOf(entry, now);
            const source = safeHttpsUrl(entry.officialSourceUrl);
            return (
              <tr key={entry.id} className="align-top hover:bg-navy-50/50">
                <td className="px-4 py-3 text-sm text-navy-800">{t.categoryLabels[entry.category]}</td>
                <td className="px-4 py-3 font-semibold text-navy-900">{truncate(entry.title, 120)}</td>
                <td className="px-4 py-3 font-mono text-xs uppercase text-navy-700" dir="ltr">{entry.country}</td>
                <td className="px-4 py-3 font-mono text-xs uppercase text-navy-700" dir="ltr">{entry.language}</td>
                <td className="px-4 py-3 text-sm text-navy-800">{t.reliabilityLabels[entry.reliabilityStatus]}</td>
                <td className="px-4 py-3">
                  <Badge tone={freshnessTone(freshness)}>{t.freshnessLabels[freshness]}</Badge>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{entry.verifiedAt ? formatDateTime(entry.verifiedAt, locale) : "—"}</td>
                <td className="px-4 py-3 text-xs">
                  {source ? (
                    <a href={source} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-navy-700 underline-offset-4 hover:underline">
                      {t.sourceLink}
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}
    </Panel>
  );
}
