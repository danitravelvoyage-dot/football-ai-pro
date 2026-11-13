import { Trophy } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { COMPETITIONS } from "@/lib/competitions";
import { getI18n } from "@/lib/i18n/server";

export const metadata = { title: "Leagues" };

export default async function LeaguesPage() {
  const { t } = await getI18n();
  return (
    <>
      <PageHeader title={t("leagues.title")} subtitle={t("leagues.subtitle")} />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {COMPETITIONS.map((c) => (
          <li key={c.code}>
            <Link href={`/leagues/${c.code}`} className="panel flex items-center gap-4 p-5 transition hover:border-emerald-500/40 hover:shadow-glow">
              <span className="grid h-12 w-12 place-items-center rounded-xl border border-line" style={{ background: `${c.color}22` }}>
                <Trophy className="h-6 w-6" style={{ color: c.color }} aria-hidden />
              </span>
              <div>
                <div className="font-semibold text-white" dir="ltr">{c.name}</div>
                <div className="text-xs text-mute">{c.country} · <span dir="ltr">{c.code}</span></div>
                {!c.footballDataFree && <div className="mt-1 text-[10px] text-gold-300">{t("provider.notInPlan")}</div>}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
