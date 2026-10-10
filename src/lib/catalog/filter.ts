import type { AttributeDefinition, AttributeValue, Category, Product } from "./types";
import type { ProductSort } from "./sort";

export type FilterSelection = Record<string, string[]>;
export type FilterOption = { value: string; label: string };
export type FilterGroup = { key: string; label: AttributeDefinition["label"]; options: FilterOption[] };
export type CatalogSearchParams = Record<string, string | string[] | undefined>;

export function filterValueSlug(value: string) {
  return value.normalize("NFKC").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
}

function attributeValues(value: AttributeValue | undefined): string[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).map(String);
}

export function matchesCategory(product: Product, category: Category) {
  return product[category.depth === 1 ? "categoryId" : category.depth === 2 ? "subcategoryId" : "childCategoryId"] === category.id;
}

export function getFilterGroups(category: Category, source: readonly Product[], definitions: readonly AttributeDefinition[]): FilterGroup[] {
  const scoped = source.filter((product) => matchesCategory(product, category));
  const topId = category.depth === 1 ? category.id : scoped[0]?.categoryId;
  return definitions.filter((definition) => topId && definition.categoryIds.includes(topId)).flatMap((definition) => {
    const values = new Map<string, string>();
    for (const product of scoped) {
      for (const value of attributeValues(product.attributes[definition.key])) values.set(filterValueSlug(value), value);
      for (const variant of product.variants) {
        for (const value of attributeValues(variant.attributes[definition.key])) values.set(filterValueSlug(value), value);
      }
    }
    const options = [...values].filter(([value]) => value).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "en"));
    return options.length ? [{ key: definition.key, label: definition.label, options }] : [];
  });
}

export function parseFilterSelection(params: CatalogSearchParams, groups: readonly FilterGroup[]): FilterSelection {
  const selection: FilterSelection = {};
  for (const group of groups) {
    const allowed = new Set(group.options.map((option) => option.value));
    const raw = params[group.key];
    const chosen = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).filter((value) => allowed.has(value));
    if (chosen.length) selection[group.key] = group.options.map((option) => option.value).filter((value) => chosen.includes(value));
  }
  return selection;
}

export function filterProducts(source: readonly Product[], category: Category, selection: FilterSelection): Product[] {
  return source.filter((product) => {
    if (!matchesCategory(product, category)) return false;
    const constraints = Object.entries(selection).filter(([, values]) => values.length);
    if (!constraints.length) return true;
    // All variant-specific conditions must hold on the same purchasable variant.
    return product.variants.some((variant) => constraints.every(([key, selected]) => {
      const values = [...attributeValues(product.attributes[key]), ...attributeValues(variant.attributes[key])];
      return values.some((value) => selected.includes(filterValueSlug(value)));
    }));
  });
}

export function filterQuery(selection: FilterSelection, groups: readonly FilterGroup[], page?: number, sort: ProductSort = "featured") {
  const params = new URLSearchParams();
  for (const group of groups) for (const value of group.options) {
    if (selection[group.key]?.includes(value.value)) params.append(group.key, value.value);
  }
  if (sort !== "featured") params.set("sort", sort);
  if (page && page > 1) params.set("page", String(page));
  return params.toString();
}

export function filterHref(basePath: string, selection: FilterSelection, groups: readonly FilterGroup[], page?: number, sort: ProductSort = "featured") {
  const query = filterQuery(selection, groups, page, sort);
  return query ? `${basePath}?${query}` : basePath;
}

export function toggleFilter(selection: FilterSelection, key: string, value: string): FilterSelection {
  const next = { ...selection, [key]: (selection[key] ?? []).includes(value)
    ? (selection[key] ?? []).filter((item) => item !== value)
    : [...(selection[key] ?? []), value] };
  if (!next[key].length) delete next[key];
  return next;
}
