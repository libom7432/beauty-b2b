import type { Locale } from "@/i18n/config";
import type { AttributeValue, Category, Product } from "./types";
import { normalizeSearchQuery, searchProducts } from "./search";

export type ProductSuggestion = { product: Product; sku: string; rank: number };
export type SuggestionKeyResult = { activeIndex: number; action: "none" | "navigate" | "close" };

const normalized = (value: string) => value.normalize("NFKC").toLowerCase();
const attributeText = (value: AttributeValue) => Array.isArray(value) ? value.join(" ") : String(value);

// Ranking only reorders products already returned by the full search engine.
export function getProductSuggestions(
  query: string, productSource: readonly Product[], categorySource: readonly Category[], locale: Locale, limit = 5,
): ProductSuggestion[] {
  const needle = normalized(normalizeSearchQuery(query));
  if (Array.from(needle).length < 2 || limit < 1) return [];

  const categoriesById = new Map(categorySource.map((category) => [category.id, category]));
  return searchProducts(query, productSource, categorySource).map((product) => {
    const skus = product.variants.map((variant) => variant.sku);
    const exactSku = skus.find((sku) => normalized(sku) === needle);
    const prefixSku = skus.find((sku) => normalized(sku).startsWith(needle));
    const matchingSku = skus.find((sku) => normalized(sku).includes(needle));
    const names = [product.name[locale], product.name[locale === "en" ? "zh" : "en"]].map(normalized);
    const categoryText = [product.categoryId, product.subcategoryId, product.childCategoryId]
      .map((id) => id ? categoriesById.get(id) : undefined)
      .filter((category): category is Category => Boolean(category))
      .flatMap((category) => [category.name.en, category.name.zh, category.slug]);
    const keywords = [product.slug, product.productCode, ...categoryText,
      ...Object.values(product.attributes).map(attributeText),
      ...product.variants.flatMap((variant) => Object.values(variant.attributes).map(attributeText))]
      .map(normalized).join(" ");
    const terms = needle.split(" ");
    const rank = exactSku ? 0 : prefixSku ? 1 : names.some((name) => name.startsWith(needle)) ? 2
      : names.some((name) => name.includes(needle)) ? 3
        : terms.some((term) => keywords.includes(term)) ? 4 : 5;
    return { product, sku: exactSku ?? prefixSku ?? matchingSku ?? skus[0] ?? "", rank };
  }).sort((a, b) => a.rank - b.rank || (a.product.id < b.product.id ? -1 : a.product.id > b.product.id ? 1 : 0)).slice(0, limit);
}

export function suggestionKeyAction(key: string, activeIndex: number, optionCount: number): SuggestionKeyResult {
  if (key === "Escape") return { activeIndex: -1, action: "close" };
  if (key === "ArrowDown" && optionCount > 0) return { activeIndex: (activeIndex + 1) % optionCount, action: "none" };
  if (key === "ArrowUp" && optionCount > 0) return { activeIndex: activeIndex < 1 ? optionCount - 1 : activeIndex - 1, action: "none" };
  if (key === "Enter" && activeIndex >= 0 && activeIndex < optionCount) return { activeIndex, action: "navigate" };
  return { activeIndex, action: "none" };
}
