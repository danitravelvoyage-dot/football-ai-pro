import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/config";
import { locales } from "@/lib/i18n/config";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ["", "/services", "/privacy"];
  return locales.flatMap((locale) =>
    pages.map((page) => ({
      url: `${siteConfig.siteUrl}/${locale}${page}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: page === "" ? 1 : 0.7,
      alternates: {
        languages: Object.fromEntries(locales.map((l) => [l, `${siteConfig.siteUrl}/${l}${page}`])),
      },
    })),
  );
}
