import type { Locale } from "@/i18n/config";
import type { Product } from "./types";

export type ProductSort = "featured" | "name-asc" | "name-desc";

export function parseProductSort(value: string | string[] | undefined): ProductSort {
  return value === "name-asc" || value === "name-desc" ? value : "featured";
}

export function searchSortHref(basePath: string, query: string, sort: ProductSort) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (query && sort !== "featured") params.set("sort", sort);
  return params.size ? `${basePath}?${params}` : basePath;
}

export function sortProducts(source: readonly Product[], sort: ProductSort, locale: Locale): Product[] {
  const names = new Intl.Collator(locale, { sensitivity: "base" });
  return [...source].sort((a, b) => {
    if (sort === "featured" && a.featured !== b.featured) return a.featured ? -1 : 1;
    if (sort !== "featured") {
      const compared = names.compare(a.name[locale], b.name[locale]);
      if (compared) return sort === "name-asc" ? compared : -compared;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
