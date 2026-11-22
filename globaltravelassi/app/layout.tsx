import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Cairo, Playfair_Display } from "next/font/google";
import { isLocale, defaultLocale, textDirection, type Locale } from "@/lib/i18n/config";
import { siteConfig } from "@/lib/config";
import "./globals.css";

// Content (services, prices, request status) must always be fresh: render on every request.
export const dynamic = "force-dynamic";

const body = Cairo({ subsets: ["arabic", "latin"], weight: ["400", "500", "600", "700"], variable: "--font-body", display: "swap" });
const display = Playfair_Display({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.siteUrl),
  title: { default: "GLOBALTRAVELASSI", template: "%s · GLOBALTRAVELASSI" },
  description: "GLOBALTRAVELASSI: visa appointments, visa consulting and file assistance, e-visas, flights, hotels, itineraries and transit advice for Algeria and North Africa.",
  applicationName: "GLOBALTRAVELASSI",
  robots: { index: true, follow: true },
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#0e2140",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const requested = (await headers()).get("x-locale") ?? defaultLocale;
  const locale: Locale = isLocale(requested) ? requested : defaultLocale;
  return (
    <html lang={locale} dir={textDirection(locale)} className={`${body.variable} ${display.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
