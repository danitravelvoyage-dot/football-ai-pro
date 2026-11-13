"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { KELLY_FRACTIONS } from "@/lib/betting";
import { LOCALE_COOKIE, TZ_COOKIE } from "@/lib/i18n";
import { useI18n } from "./I18nProvider";
import { setCookie } from "./LanguageSwitcher";
import { readSettings, SETTINGS_KEY } from "./ValueCalculator";

export function SettingsForm() {
  const { t, locale, tz } = useI18n();
  const router = useRouter();
  const [lang, setLang] = useState(locale);
  const [zone, setZone] = useState(tz);
  const [kelly, setKelly] = useState(0.25);
  const [bankroll, setBankroll] = useState("1000");
  const [saved, setSaved] = useState(false);
  const zones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
    } catch {
      return ["UTC", "Europe/London", "Asia/Riyadh", "Africa/Cairo", "Asia/Dubai"];
    }
  }, []);
  useEffect(() => {
    const s = readSettings();
    setKelly(s.kelly);
    setBankroll(String(s.bankroll));
  }, []);
  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        setCookie(LOCALE_COOKIE, lang);
        if (zones.includes(zone) || zone === "UTC") setCookie(TZ_COOKIE, zone);
        try {
          localStorage.setItem(SETTINGS_KEY, JSON.stringify({ kelly, bankroll: Math.max(0, Number(bankroll) || 0) }));
        } catch {
          /* storage unavailable */
        }
        setSaved(true);
        router.refresh();
      }}
    >
      <label><span className="eyebrow mb-1 block">{t("settings.language")}</span>
        <select className="input" value={lang} onChange={(e) => setLang(e.target.value as typeof lang)}>
          <option value="ar">العربية</option><option value="en">English</option>
        </select>
      </label>
      <label><span className="eyebrow mb-1 block">{t("settings.timezone")}</span>
        <select className="input" value={zone} onChange={(e) => setZone(e.target.value)} dir="ltr">
          {!zones.includes("UTC") && <option value="UTC">UTC</option>}
          {zones.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
        <span className="mt-1 block text-[11px] text-mute">{t("settings.timezoneHint")}</span>
      </label>
      <label><span className="eyebrow mb-1 block">{t("settings.kelly")}</span>
        <select className="input" value={kelly} onChange={(e) => setKelly(Number(e.target.value))}>
          {KELLY_FRACTIONS.map((f) => <option key={f} value={f}>{f * 100}% Kelly</option>)}
        </select>
      </label>
      <label><span className="eyebrow mb-1 block">{t("settings.bankroll")}</span>
        <input className="input num" inputMode="decimal" value={bankroll} onChange={(e) => setBankroll(e.target.value)} dir="ltr" />
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button className="btn btn-primary">{t("common.save")}</button>
        {saved && <span role="status" className="text-xs text-emerald-400">{t("common.saved")}</span>}
      </div>
    </form>
  );
}
