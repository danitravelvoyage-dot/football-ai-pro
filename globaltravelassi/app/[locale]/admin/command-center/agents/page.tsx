import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, type Locale } from "@/lib/i18n";
import { loadCommandCenter } from "@/lib/ai/command-center/load";
import { rollupByAgent } from "@/lib/ai/command-center/view";
import { AGENT_REGISTRY } from "@/lib/ai/registry";
import { DEPARTMENTS } from "@/lib/ai/departments";
import { Panel } from "@/components/admin/AdminUI";
import { Fact, LoadState } from "@/components/admin/command-center/Parts";

export const metadata: Metadata = { title: "Agent workforce", robots: { index: false, follow: false } };

export default async function AgentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const t = dict.commandCenter;

  const state = await loadCommandCenter();
  if (state.status !== "ok") return <LoadState kind={state.status} dict={dict} />;
  const rollups = rollupByAgent(state.tasks);

  return (
    <>
      {DEPARTMENTS.map((department) => (
        <Panel key={department.key} title={t.departments[department.key]}>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {department.agents.map((agentKey) => {
              const def = AGENT_REGISTRY[agentKey];
              const r = rollups[agentKey];
              return (
                <article key={agentKey} className="flex flex-col rounded-2xl border border-navy-100 bg-white p-5">
                  <p className="font-mono text-xs text-navy-500" dir="ltr">{agentKey}</p>
                  <h3 className="mt-1 font-display text-lg font-semibold text-navy-900">{def.name}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-navy-700">{def.mission}</p>

                  <dl className="mt-5 grid grid-cols-3 gap-3">
                    <Fact label={t.runs} value={r.total} />
                    <Fact label={t.activeNow} value={r.active} />
                    <Fact label={t.failures} value={r.failed} />
                  </dl>

                  <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-navy-500">{t.tools}</p>
                  <p className="mt-1 font-mono text-xs text-navy-700" dir="ltr">{def.tools.length > 0 ? def.tools.join(", ") : "—"}</p>

                  <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-navy-500">{t.promptVersion}</p>
                  <p className="mt-1 font-mono text-xs text-navy-700" dir="ltr">{def.prompt.version}</p>

                  <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-navy-500">{t.boundaries}</p>
                  <ul className="mt-1 list-disc space-y-1 ps-5 text-xs leading-relaxed text-navy-700">
                    {def.boundaries.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
        </Panel>
      ))}
    </>
  );
}
