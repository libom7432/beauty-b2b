import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site/config";
import { localizedPath } from "@/lib/site/paths";
import { locales } from "@/i18n/config";

// Only routes explicitly marked indexable by their page metadata are listed.
// Category listings and their paginated URLs remain noindex while products are mock data.
export default function sitemap(): MetadataRoute.Sitemap {
  if (!siteConfig.siteUrl) return [];
  const paths = ["/", "/products"];
  return locales.flatMap((locale) => paths.map((path) => ({ url: `${siteConfig.siteUrl}${localizedPath(locale, path)}`, changeFrequency: "monthly" as const, priority: path === "/" ? 1 : .6 })));
}
