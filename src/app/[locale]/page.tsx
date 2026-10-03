import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary } from "@/i18n/dictionaries";
import { isLocale } from "@/i18n/config";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const copy = getDictionary(locale);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6 py-16">
      <nav aria-label={copy.languageLabel} className="mb-16 flex gap-4 text-sm">
        <Link href="/en" lang="en" aria-current={locale === "en" ? "page" : undefined}>
          English
        </Link>
        <Link href="/zh" lang="zh" aria-current={locale === "zh" ? "page" : undefined}>
          中文
        </Link>
      </nav>
      <p className="mb-3 text-sm tracking-[0.2em] uppercase">B2B Beauty</p>
      <h1 className="mb-6 text-4xl font-semibold tracking-tight sm:text-5xl">
        {copy.heading}
      </h1>
      <p className="max-w-2xl text-lg leading-8 text-neutral-600">{copy.description}</p>
    </main>
  );
}
