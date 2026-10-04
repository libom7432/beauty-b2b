"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Locale } from "@/i18n/config";

export function LanguageSwitcher({ locale, label }: { locale: Locale; label: string }) {
  const pathname = usePathname();
  const remainder = pathname.replace(/^\/(en|zh)(?=\/|$)/, "");

  return (
    <nav className="language-switcher" aria-label={label}>
      <Link href={`/en${remainder}`} lang="en" aria-current={locale === "en" ? "page" : undefined}>EN</Link>
      <span aria-hidden="true">/</span>
      <Link href={`/zh${remainder}`} lang="zh" aria-current={locale === "zh" ? "page" : undefined}>中文</Link>
    </nav>
  );
}
