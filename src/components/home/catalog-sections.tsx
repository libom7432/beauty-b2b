import Link from "next/link";
import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { getTopCategories } from "@/lib/catalog/taxonomy";
import { getNewArrivals, getFeaturedProducts } from "@/lib/catalog/products";
import { getFeaturedCollections } from "@/lib/catalog/collections";
import { insights } from "@/lib/catalog/insights";
import { localizedPath } from "@/lib/site/paths";
import { CategoryCard } from "@/components/cards/category-card";
import { CollectionCard } from "@/components/cards/collection-card";
import { ProductCard } from "@/components/cards/product-card";
import { ArticleCard } from "@/components/cards/article-card";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

function SectionIntro({ locale, copy, path, id }: { locale: Locale; copy: { eyebrow: string; title: string; body: string }; path: string; id: string }) {
  return <div className="section-intro-v3"><SectionHeading id={id} eyebrow={copy.eyebrow} title={copy.title} description={copy.body} /><Link className="text-link" href={localizedPath(locale, path)}>{getDictionary(locale).common.viewAll} <span aria-hidden="true">↗</span></Link></div>;
}

export function CategoriesSection({ locale }: { locale: Locale }) {
  return <section className="section-space" aria-labelledby="categories-title"><Container><SectionIntro locale={locale} copy={getDictionary(locale).home.categories} path="/products" id="categories-title" /><div className="category-grid-v3">{getTopCategories().map((category) => <CategoryCard key={category.id} category={category} locale={locale} />)}</div></Container></section>;
}

export function NewArrivalsSection({ locale }: { locale: Locale }) {
  const arrivals = getNewArrivals();
  return <section className="section-space tinted-section" aria-labelledby="new-arrivals-title"><Container><SectionIntro locale={locale} copy={getDictionary(locale).home.newArrivals} path="/new-arrivals" id="new-arrivals-title" /><div className={`product-grid-v3${arrivals.length === 2 ? " new-arrivals-grid-two" : ""}`}>{arrivals.map((product) => <ProductCard key={product.id} product={product} locale={locale} />)}</div></Container></section>;
}

export function CollectionsSection({ locale }: { locale: Locale }) {
  const homeCollections = getFeaturedCollections().filter((collection) => ["minimal", "french", "chrome"].includes(collection.slug));
  return <section className="section-space home-collections-section" aria-labelledby="collections-title"><Container><SectionIntro locale={locale} copy={getDictionary(locale).home.collections} path="/collections" id="collections-title" /><div className="collection-grid-v3">{homeCollections.map((collection) => <CollectionCard key={collection.id} collection={collection} locale={locale} />)}</div></Container></section>;
}

export function FeaturedProductsSection({ locale }: { locale: Locale }) {
  return <section className="section-space" aria-labelledby="featured-title"><Container><SectionIntro locale={locale} copy={getDictionary(locale).home.featured} path="/products" id="featured-title" /><div className="product-grid-v3">{getFeaturedProducts().map((product) => <ProductCard key={product.id} product={product} locale={locale} />)}</div></Container></section>;
}

export function InsightsSection({ locale }: { locale: Locale }) {
  return <section className="section-space tinted-section insights-section" aria-labelledby="insights-title"><Container><SectionIntro locale={locale} copy={getDictionary(locale).home.insights} path="/insights" id="insights-title" /><div className="article-grid-v3">{insights.map((article) => <ArticleCard key={article.id} article={article} locale={locale} />)}</div></Container></section>;
}
