"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Locale } from "@/i18n/config";
import { localizedPath, pathWithoutLocale } from "@/lib/site/paths";

export function LanguageSwitcher({ locale, label }: { locale: Locale; label: string }) {
  const pathname = usePathname();
  const path = pathWithoutLocale(pathname);

  return (
    <nav className="language-switcher" aria-label={label}>
      <Link href={localizedPath("en", path)} lang="en" aria-current={locale === "en" ? "page" : undefined}>EN</Link>
      <span aria-hidden="true">/</span>
      <Link href={localizedPath("zh", path)} lang="zh" aria-current={locale === "zh" ? "page" : undefined}>中文</Link>
    </nav>
  );
}
