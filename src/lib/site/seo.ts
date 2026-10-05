import type { Metadata } from "next";
import type { Locale } from "@/i18n/config";
import { localizedPath } from "./paths";
import { siteConfig } from "./config";

type SeoInput = { locale: Locale; path: string; title: string; description: string; indexable?: boolean };

export function pageMetadata({ locale, path, title, description, indexable = false }: SeoInput): Metadata {
  const siteUrl = siteConfig.siteUrl;
  const canonicalPath = localizedPath(locale, path);
  return {
    title: `${title} | ${siteConfig.brandPlaceholder}`,
    description,
    metadataBase: siteUrl ? new URL(siteUrl) : undefined,
    alternates: siteUrl ? {
      canonical: `${siteUrl}${canonicalPath}`,
      languages: { en: `${siteUrl}${localizedPath("en", path)}`, zh: `${siteUrl}${localizedPath("zh", path)}` },
    } : undefined,
    openGraph: {
      type: "website", siteName: siteConfig.brandPlaceholder,
      title: `${title} | ${siteConfig.brandPlaceholder}`, description,
      locale: locale === "en" ? "en_US" : "zh_CN",
      url: siteUrl ? `${siteUrl}${canonicalPath}` : undefined,
    },
    robots: { index: Boolean(siteUrl && indexable), follow: Boolean(siteUrl && indexable) },
  };
}
