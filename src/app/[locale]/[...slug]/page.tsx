import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale, locales, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";

type Props = { params: Promise<{ locale: string; slug: string[] }> };

function getTitle(locale: Locale, slug: string[]) {
  const titles: Record<string, string> = getDictionary(locale).placeholder.titles;
  return titles[slug.join("/")];
}

export function generateStaticParams() {
  const routes = Object.keys(getDictionary("en").placeholder.titles);
  return locales.flatMap((locale) => routes.map((route) => ({ locale, slug: route.split("/") })));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const title = getTitle(locale, slug);
  if (!title) notFound();
  const path = slug.join("/");
  return {
    title: `${title} | Brand`,
    alternates: { languages: { en: `/en/${path}`, zh: `/zh/${path}` } },
  };
}

export default async function PlaceholderPage({ params }: Props) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const copy = getDictionary(locale).placeholder;
  const title = getTitle(locale, slug);
  if (!title) notFound();

  return (
    <main className="placeholder-page site-container">
      <p className="eyebrow">{copy.eyebrow}</p>
      <h1 className="section-title">{title}</h1>
      <p className="section-description">{copy.body}</p>
      <Link className="button button-dark" href={`/${locale}`}><span>{copy.back}</span><span aria-hidden="true" className="button-arrow">↗</span></Link>
    </main>
  );
}
