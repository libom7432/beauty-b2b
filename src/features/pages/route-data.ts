import { notFound } from "next/navigation";
import type { Locale } from "@/i18n/config";
import { getCategoryByPath, getCategorySlugPath } from "@/lib/catalog/taxonomy";
import { getProductBySlug } from "@/lib/catalog/products";
import { getCollectionBySlug } from "@/lib/catalog/collections";
import { getInsightBySlug } from "@/lib/catalog/insights";
import { pageMetadata } from "@/lib/site/seo";

export function requireCategory(slugs: string[]) {
  const category = getCategoryByPath(slugs);
  if (!category || category.depth !== slugs.length) notFound();
  return category;
}

export function categoryMetadata(locale: Locale, slugs: string[]) {
  const category = requireCategory(slugs);
  return pageMetadata({ locale, path: `/products/${getCategorySlugPath(category).join("/")}`, title: category.seo.title[locale], description: category.seo.description[locale], indexable: category.seo.indexable });
}

export function legacyToolsCareMetadata(locale: Locale) {
  return pageMetadata({
    locale, path: "/products/nail-tools-care",
    title: locale === "zh" ? "美甲工具与护理" : "Nail Tools & Care",
    description: locale === "zh" ? "分别探索美甲工具与美甲护理分类。" : "Explore the nail tools and nail care categories.",
    indexable: false,
  });
}

export function requireProduct(slug: string) {
  const product = getProductBySlug(slug);
  if (!product) notFound();
  return product;
}
export function productMetadata(locale: Locale, slug: string) {
  const product = requireProduct(slug);
  return pageMetadata({ locale, path: `/product/${slug}`, title: product.seo.title[locale], description: product.seo.description[locale], indexable: product.seo.indexable });
}

export function requireCollection(slug: string) {
  const collection = getCollectionBySlug(slug);
  if (!collection) notFound();
  return collection;
}
export function collectionMetadata(locale: Locale, slug: string) {
  const collection = requireCollection(slug);
  return pageMetadata({ locale, path: `/collections/${slug}`, title: collection.seo.title[locale], description: collection.seo.description[locale], indexable: collection.seo.indexable });
}

export function requireInsight(slug: string) {
  const article = getInsightBySlug(slug);
  if (!article) notFound();
  return article;
}
export function insightMetadata(locale: Locale, slug: string) {
  const article = requireInsight(slug);
  return pageMetadata({ locale, path: `/insights/${slug}`, title: article.seo.title[locale], description: article.seo.description[locale], indexable: article.seo.indexable });
}
