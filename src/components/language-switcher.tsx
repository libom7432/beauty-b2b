"use client";

import Link from "next/link";
import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { Locale } from "@/i18n/config";
import { localizedPath, pathWithoutLocale } from "@/lib/site/paths";

export function LanguageSwitcher({ locale, label }: { locale: Locale; label: string }) {
  const pathname = usePathname();
  const path = pathWithoutLocale(pathname);
  return <nav className="language-switcher" aria-label={label}><Suspense fallback={<LanguageLinks locale={locale} path={path} />}><QueryAwareLinks locale={locale} path={path} /></Suspense></nav>;
}

function QueryAwareLinks({ locale, path }: { locale: Locale; path: string }) {
  const params = useSearchParams();
  const searchQuery = new URLSearchParams();
  if (path === "/search") {
    const q = params?.get("q");
    const sort = params?.get("sort");
    if (q) searchQuery.set("q", q);
    if (q && (sort === "name-asc" || sort === "name-desc")) searchQuery.set("sort", sort);
  }
  const query = path === "/search" ? searchQuery.toString() : path.startsWith("/products/") ? params?.toString() : "";
  return <LanguageLinks locale={locale} path={path} query={query ?? ""} />;
}

function LanguageLinks({ locale, path, query = "" }: { locale: Locale; path: string; query?: string }) {
  const destination = (target: Locale) => `${localizedPath(target, path)}${query ? `?${query}` : ""}`;
  return (
    <>
      <Link href={destination("en")} lang="en" aria-current={locale === "en" ? "page" : undefined}>EN</Link>
      <span aria-hidden="true">/</span>
      <Link href={destination("zh")} lang="zh" aria-current={locale === "zh" ? "page" : undefined}>中文</Link>
    </>
  );
}
