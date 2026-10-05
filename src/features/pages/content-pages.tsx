import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import type { Insight } from "@/lib/catalog/types";
import { insights } from "@/lib/catalog/insights";
import { localizedPath } from "@/lib/site/paths";
import { ArticleCard } from "@/components/cards/article-card";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";

export type StaticPageKey = "privateLabel" | "solutions" | "about" | "contact" | "rfq";

export function StaticLandingPage({ locale, page }: { locale: Locale; page: StaticPageKey }) {
  const copy = getDictionary(locale);
  const content = copy.pages[page];
  return <main><Container className="static-page"><p className="eyebrow">{content.eyebrow}</p><h1>{content.title}</h1><p>{content.body}</p>
    {page === "privateLabel" && <ul className="static-list">{copy.home.privateLabel.items.map((item) => <li key={item}>{item}</li>)}</ul>}
    {page === "solutions" && <div className="solutions-grid static-solutions">{copy.home.solutions.audiences.map((audience, index) => <article key={audience.title}><span>0{index + 1}</span><h2>{audience.title}</h2><p>{audience.body}</p></article>)}</div>}
    {page !== "rfq" && page !== "contact" && <Button href={localizedPath(locale, "/rfq")}>{copy.common.requestQuote}</Button>}
  </Container></main>;
}

export function InsightsIndexPage({ locale }: { locale: Locale }) {
  const copy = getDictionary(locale).pages.insights;
  return <main><Container><div className="route-intro"><p className="eyebrow">{copy.eyebrow}</p><h1>{copy.title}</h1><p>{copy.body}</p></div><div className="article-grid-v3 route-grid">{insights.map((article) => <ArticleCard key={article.id} article={article} locale={locale} />)}</div></Container></main>;
}

export function InsightDetailPage({ locale, article }: { locale: Locale; article: Insight }) {
  const copy = getDictionary(locale);
  return <main><Container className="static-page"><p className="eyebrow">{article.topic[locale]}</p><h1>{article.title[locale]}</h1><p>{article.excerpt[locale]}</p><p className="route-empty">{copy.common.comingSoon}</p></Container></main>;
}
