import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site/config";
import { localizedPath } from "@/lib/site/paths";
import { locales } from "@/i18n/config";
import { categories, getCategorySlugPath } from "@/lib/catalog/taxonomy";

// Only substantive routes are listed; mock product, collection, and article details remain noindex.
export default function sitemap(): MetadataRoute.Sitemap {
  if (!siteConfig.siteUrl) return [];
  const paths = ["/", "/products", ...categories.filter((category) => category.seo.indexable).map((category) => `/products/${getCategorySlugPath(category).join("/")}`)];
  return locales.flatMap((locale) => paths.map((path) => ({ url: `${siteConfig.siteUrl}${localizedPath(locale, path)}`, changeFrequency: "monthly" as const, priority: path === "/" ? 1 : .6 })));
}
