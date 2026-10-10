import Link from "next/link";
import { redirect } from "next/navigation";
import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { products } from "@/lib/catalog/products";
import { categories } from "@/lib/catalog/taxonomy";
import { normalizeSearchQuery, searchProducts } from "@/lib/catalog/search";
import { parseProductSort, searchSortHref, sortProducts, type ProductSort } from "@/lib/catalog/sort";
import { localizedPath } from "@/lib/site/paths";
import { ProductCard } from "@/components/cards/product-card";
import { Container } from "@/components/ui/container";
import { ProductSortSelect } from "@/components/product-sort-select";
import { SearchAutocomplete } from "@/components/search-autocomplete";

export function SearchResultsPage({ locale, searchParams = {} }: { locale: Locale; searchParams?: Record<string, string | string[] | undefined> }) {
  const copy = getDictionary(locale);
  const rawQuery = searchParams.q;
  const query = normalizeSearchQuery(typeof rawQuery === "string" ? rawQuery : rawQuery?.[0] ?? "");
  const sort = parseProductSort(searchParams.sort);
  const matches = sortProducts(searchProducts(query, products, categories), sort, locale);
  const searchPath = localizedPath(locale, "/search");
  const canonicalPath = searchSortHref(searchPath, query, sort);
  const rawParams = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) rawParams.append(key, item);
  if (rawParams.toString() !== (canonicalPath.split("?")[1] ?? "")) redirect(canonicalPath);
  const sortOptions = (["featured", "name-asc", "name-desc"] as ProductSort[]).map((value) => ({ value, label: copy.sort[value], href: searchSortHref(searchPath, query, value) }));

  return <main><Container>
    <div className="route-intro search-intro"><p className="eyebrow">{copy.search.eyebrow}</p><h1>{copy.search.title}</h1><p>{copy.search.description}</p></div>
    <SearchAutocomplete key={query} locale={locale} initialQuery={query} />
    {query ? <section className="search-results" aria-label={copy.search.results}>
      <div className="search-results-heading"><div><p className="eyebrow">{copy.search.results}</p><h2>{copy.search.queryLabel} <span>“{query}”</span></h2><p>{copy.search.count.replace("{count}", String(matches.length))}</p></div><div className="search-results-actions"><ProductSortSelect label={copy.sort.label} value={sort} options={sortOptions} /><Link href={searchPath}>{copy.search.clear}</Link></div></div>
      {matches.length > 0 ? <div className="product-grid-v3 product-listing-grid">{matches.map((product) => <ProductCard key={product.id} product={product} locale={locale} listing />)}</div>
        : <div className="search-empty"><p>{copy.search.empty}</p><Link href={localizedPath(locale, "/products")}>{copy.search.browseAll}</Link></div>}
    </section> : <p className="search-prompt">{copy.search.prompt} <Link href={localizedPath(locale, "/products")}>{copy.search.browseAll}</Link></p>}
  </Container></main>;
}
