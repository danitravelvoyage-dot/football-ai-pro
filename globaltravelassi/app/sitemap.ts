import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/config";
import { locales } from "@/lib/i18n/config";
import { businessServiceSlugs } from "@/lib/services-content";

/** Public pages only. Customer and admin areas are excluded (see robots.ts). */
export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ["", "/services", "/privacy", "/terms", "/cookies", ...businessServiceSlugs.map((slug) => `/services/${slug}`)];
  return locales.flatMap((locale) =>
    pages.map((page) => ({
      url: `${siteConfig.siteUrl}/${locale}${page}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: page === "" ? 1 : page.startsWith("/services/") ? 0.8 : 0.6,
      alternates: {
        languages: Object.fromEntries(locales.map((l) => [l, `${siteConfig.siteUrl}/${l}${page}`])),
      },
    })),
  );
}
