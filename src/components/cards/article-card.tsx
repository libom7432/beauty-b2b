import Link from "next/link";
import type { Locale } from "@/i18n/config";
import type { Insight } from "@/lib/catalog/types";
import { localizedPath } from "@/lib/site/paths";
import { getDictionary } from "@/i18n/dictionaries";

export function ArticleCard({ article, locale }: { article: Insight; locale: Locale }) {
  const href = localizedPath(locale, `/insights/${article.slug}`);
  return <article className="article-card-v3"><p className="eyebrow">{article.topic[locale]}</p><h3><Link href={href}>{article.title[locale]}</Link></h3><p>{article.excerpt[locale]}</p><Link href={href} className="text-link">{getDictionary(locale).common.learnMore} <span aria-hidden="true">↗</span></Link></article>;
}
