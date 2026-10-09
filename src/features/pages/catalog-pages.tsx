import Link from "next/link";
import { redirect } from "next/navigation";
import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import type { Category, Product, Collection } from "@/lib/catalog/types";
import { getTopCategories, getCategoryChildren, getCategoryById, getCategorySlugPath } from "@/lib/catalog/taxonomy";
import { getProductsForCategory, getNewArrivals, paginateProducts, products } from "@/lib/catalog/products";
import { collections } from "@/lib/catalog/collections";
import { localizedPath } from "@/lib/site/paths";
import { CategoryCard } from "@/components/cards/category-card";
import { ProductCard } from "@/components/cards/product-card";
import { CollectionCard } from "@/components/cards/collection-card";
import { CatalogMedia } from "@/components/catalog-media";
import { Container } from "@/components/ui/container";
import { ProductDetailPanel } from "@/components/product-detail-panel";

function Intro({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return <div className="route-intro"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{body}</p></div>;
}

export function ProductsIndexPage({ locale }: { locale: Locale }) {
  const copy = getDictionary(locale).pages.products;
  return <main><Container><Intro eyebrow={copy.eyebrow} title={copy.title} body={copy.body} /><div className="category-grid-v3 route-grid">{getTopCategories().map((category) => <CategoryCard key={category.id} category={category} locale={locale} />)}</div></Container></main>;
}

// The former combined category remains a useful entry point to both new branches.
export function LegacyToolsCarePage({ locale }: { locale: Locale }) {
  const copy = getDictionary(locale);
  const destinations = ["nail-tools", "nail-care"];
  return <main><Container><div className="route-breadcrumb"><Link href={localizedPath(locale, "/products")}>{copy.nav.products}</Link><span aria-hidden="true">/</span><span>{locale === "zh" ? "美甲工具与护理" : "Nail Tools & Care"}</span></div>
    <Intro eyebrow={copy.nav.products} title={locale === "zh" ? "美甲工具与护理" : "Nail Tools & Care"} body={locale === "zh" ? "根据产品用途，探索美甲工具与美甲护理两个独立分类。" : "Explore nail tools and nail care as two distinct product categories."} />
    <div className="category-grid-v3 route-grid">{destinations.map((id) => {
      const category = getCategoryById(id);
      return category ? <CategoryCard key={id} category={category} locale={locale} /> : null;
    })}</div>
  </Container></main>;
}

export function CategoryPage({ locale, category, pageQuery }: { locale: Locale; category: Category; pageQuery?: string | string[] }) {
  const copy = getDictionary(locale);
  const children = getCategoryChildren(category.id);
  const categoryProducts = getProductsForCategory(category);
  const pagination = paginateProducts(categoryProducts, pageQuery);
  const basePath = localizedPath(locale, `/products/${getCategorySlugPath(category).join("/")}`);
  if (pagination.canonicalRedirect) redirect(basePath);
  const pagePath = (page: number) => page === 1 ? basePath : `${basePath}?page=${page}`;
  return <main><Container><div className="route-breadcrumb"><Link href={localizedPath(locale, "/products")}>{copy.nav.products}</Link><span aria-hidden="true">/</span><span>{category.name[locale]}</span></div><Intro eyebrow={copy.nav.products} title={category.name[locale]} body={category.shortDescription[locale]} />
    {children.length > 0 && <div className="category-grid-v3 route-grid">{children.map((child) => <CategoryCard key={child.id} category={child} locale={locale} />)}</div>}
    <section className="route-subsection" aria-label={copy.listing.products}>
      <h2>{pagination.totalProducts} {pagination.totalProducts === 1 ? copy.listing.product : copy.listing.products}</h2>
      {pagination.totalProducts > 0 ? <div className="product-grid-v3 product-listing-grid">{pagination.items.map((product) => <ProductCard key={product.id} product={product} locale={locale} listing />)}</div>
        : <p className="route-empty">{copy.listing.empty} <Link href={localizedPath(locale, "/products")}>{copy.listing.browseCategories}</Link></p>}
      {pagination.totalPages > 1 && <nav className="product-pagination" aria-label={copy.listing.pagination}>
        {pagination.page > 1 ? <Link href={pagePath(pagination.page - 1)} rel="prev">{copy.listing.previous}</Link> : <span aria-disabled="true">{copy.listing.previous}</span>}
        <span>{copy.listing.pageStatus.replace("{page}", String(pagination.page)).replace("{total}", String(pagination.totalPages))}</span>
        {pagination.page < pagination.totalPages ? <Link href={pagePath(pagination.page + 1)} rel="next">{copy.listing.next}</Link> : <span aria-disabled="true">{copy.listing.next}</span>}
      </nav>}
    </section>
  </Container></main>;
}

export function NewArrivalsPage({ locale }: { locale: Locale }) {
  const copy = getDictionary(locale).pages.newArrivals;
  return <main><Container><Intro eyebrow={copy.eyebrow} title={copy.title} body={copy.body} /><div className="product-grid-v3 route-grid">{getNewArrivals().map((product) => <ProductCard key={product.id} product={product} locale={locale} />)}</div></Container></main>;
}

export function ProductDetailPage({ locale, product }: { locale: Locale; product: Product }) {
  const copy = getDictionary(locale);
  const hierarchy = [product.categoryId, product.subcategoryId, product.childCategoryId]
    .filter((id): id is string => Boolean(id))
    .map((id) => getCategoryById(id))
    .filter((category): category is Category => Boolean(category));
  const related = products.filter((item) => item.id !== product.id && item.categoryId === product.categoryId).slice(0, 4);
  return <main><Container>
    <nav className="route-breadcrumb product-detail-breadcrumb" aria-label={copy.nav.products}>
      <Link href={localizedPath(locale, "/products")}>{copy.nav.products}</Link>
      {hierarchy.map((category) => <span key={category.id} className="product-breadcrumb-part"><span aria-hidden="true">/</span><Link href={localizedPath(locale, `/products/${getCategorySlugPath(category).join("/")}`)}>{category.name[locale]}</Link></span>)}
      <span className="product-breadcrumb-part"><span aria-hidden="true">/</span><span aria-current="page">{product.name[locale]}</span></span>
    </nav>
    <ProductDetailPanel product={product} locale={locale} />
    {related.length > 0 && <section className="product-related" aria-labelledby="product-related-title"><h2 id="product-related-title">{copy.detail.related}</h2><div className="product-grid-v3">{related.map((item) => <ProductCard key={item.id} product={item} locale={locale} />)}</div></section>}
  </Container></main>;
}

export function CollectionsIndexPage({ locale }: { locale: Locale }) {
  const copy = getDictionary(locale).pages.collections;
  return <main><Container><Intro eyebrow={copy.eyebrow} title={copy.title} body={copy.body} /><div className="collection-grid-v3 route-grid">{collections.map((collection) => <CollectionCard key={collection.id} collection={collection} locale={locale} />)}</div></Container></main>;
}

export function CollectionDetailPage({ locale, collection }: { locale: Locale; collection: Collection }) {
  const copy = getDictionary(locale);
  const included = products.filter((product) => collection.productIds.includes(product.id));
  return <main><Container><Intro eyebrow={copy.nav.collections} title={collection.name[locale]} body={collection.shortDescription[locale]} /><div className="collection-detail-media"><CatalogMedia visual={collection.visual} /></div>{included.length > 0 ? <div className="route-subsection"><h2>{copy.home.featured.title}</h2><div className="product-grid-v3">{included.map((product) => <ProductCard key={product.id} product={product} locale={locale} />)}</div></div> : <p className="route-empty">{copy.common.noProducts}</p>}</Container></main>;
}
