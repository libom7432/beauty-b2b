import type { AttributeValue, Category, Product } from "./types";

export function normalizeSearchQuery(query: string) {
  return query.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function searchableValue(value: AttributeValue) {
  return Array.isArray(value) ? value.join(" ") : String(value);
}

// The source arrays are arguments so a verified catalog can replace Mock data later.
export function searchProducts(query: string, productSource: readonly Product[], categorySource: readonly Category[]) {
  const terms = normalizeSearchQuery(query).toLowerCase().split(" ").filter(Boolean);
  if (terms.length === 0) return [];

  const categoriesById = new Map(categorySource.map((category) => [category.id, category]));
  return productSource.filter((product) => {
    const categoryNames = [product.categoryId, product.subcategoryId, product.childCategoryId]
      .map((id) => id ? categoriesById.get(id) : undefined)
      .filter((category): category is Category => Boolean(category))
      .flatMap((category) => [category.name.en, category.name.zh, category.slug]);
    const fields = [
      product.name.en, product.name.zh,
      product.shortDescription.en, product.shortDescription.zh,
      product.description.en, product.description.zh,
      product.slug, product.productCode,
      ...categoryNames,
      ...Object.values(product.attributes).map(searchableValue),
      ...product.variants.flatMap((variant) => [variant.sku, ...Object.values(variant.attributes).map(searchableValue)]),
    ];
    const index = fields.join(" ").normalize("NFKC").toLowerCase();
    return terms.every((term) => index.includes(term));
  });
}
