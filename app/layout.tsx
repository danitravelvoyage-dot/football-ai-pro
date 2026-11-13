import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { I18nProvider } from "@/components/I18nProvider";
import { Sidebar, TopBar } from "@/components/Nav";
import { TimezoneSync } from "@/components/TimezoneSync";
import { isDemoMode } from "@/lib/env";
import { dirOf, TZ_COOKIE } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "FOOTBALL AI PRO", template: "%s · FOOTBALL AI PRO" },
  description: "Statistical football analytics, transparent probability models and betting market analysis.",
};
export const viewport: Viewport = { themeColor: "#050a15", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, tz, t } = await getI18n();
  const hasTz = !!(await cookies()).get(TZ_COOKIE)?.value;
  const demo = isDemoMode();
  return (
    <html lang={locale} dir={dirOf(locale)}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap"
        />
      </head>
      <body className="min-h-screen font-sans">
        <I18nProvider locale={locale} tz={tz}>
          <TimezoneSync hasCookie={hasTz} />
          <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded focus:bg-emerald-500 focus:px-3 focus:py-2 focus:text-ink-950">
            {t("app.skip")}
          </a>
          <div className="flex min-h-screen">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <TopBar />
              {demo && (
                <div role="note" className="border-b border-gold-400/30 bg-gold-400/[0.07] px-4 py-2 text-center text-xs font-medium text-gold-300">
                  <span className="me-2 rounded border border-gold-400/50 px-1.5 py-px text-[10px] font-bold tracking-wider">{t("demo.badge")}</span>
                  {t("demo.banner")}
                </div>
              )}
              <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-6 md:py-8">{children}</main>
              <footer className="border-t border-line px-4 py-6 text-center text-[11px] leading-relaxed text-mute md:px-6">
                <p className="mx-auto max-w-3xl">{t("disclaimer.footer")}</p>
                <p className="mt-2" dir="ltr">© FOOTBALL AI PRO · Data: football-data.org · The Odds API · API-Football (when configured)</p>
              </footer>
            </div>
          </div>
        </I18nProvider>
      </body>
    </html>
  );
}
