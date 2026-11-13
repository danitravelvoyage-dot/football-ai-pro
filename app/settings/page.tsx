import clsx from "clsx";
import { Panel, PageHeader } from "@/components/ui";
import { SettingsForm } from "@/components/SettingsForm";
import { getI18n } from "@/lib/i18n/server";
import { providerStatus } from "@/services/providers";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { t } = await getI18n();
  const st = providerStatus();
  return (
    <>
      <PageHeader title={t("settings.title")} subtitle={t("settings.subtitle")} />
      <Panel title={t("settings.title")} className="mb-6"><SettingsForm /></Panel>
      <Panel title={t("settings.providers")} right={<span className={clsx("chip", st.demo ? "text-gold-300" : "text-emerald-300")}>{t("settings.mode")}: {st.demo ? t("settings.mode.demo") : t("settings.mode.live")}</span>}>
        <ul className="grid gap-3 md:grid-cols-2">
          {st.providers.map((p) => (
            <li key={p.id} className="rounded-lg border border-line bg-ink-850 p-4">
              <div className="flex items-center justify-between gap-2">
                <a href={p.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-white hover:text-emerald-300" dir="ltr">{p.name}</a>
                <span className="flex gap-1.5">
                  <span className={clsx("chip", p.configured ? "text-emerald-300" : "text-mute")}>{p.configured ? t("settings.configured") : t("settings.notConfigured")}</span>
                  <span className={clsx("chip", p.active ? "text-emerald-300" : "text-mute")}>{p.active ? t("settings.active") : t("settings.inactive")}</span>
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-300">{t(p.role)}</p>
              <p className="mt-2 text-[11px] leading-relaxed text-mute">{t(p.freeTier)}</p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-mute">{t("settings.keysNote")}</p>
      </Panel>
    </>
  );
}
