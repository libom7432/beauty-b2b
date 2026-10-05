import Link from "next/link";
import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import type { Category, Product, Collection } from "@/lib/catalog/types";
import { getTopCategories, getCategoryChildren } from "@/lib/catalog/taxonomy";
import { getProductsForCategory, getNewArrivals, products } from "@/lib/catalog/products";
import { collections } from "@/lib/catalog/collections";
import { localizedPath } from "@/lib/site/paths";
import { CategoryCard } from "@/components/cards/category-card";
import { ProductCard } from "@/components/cards/product-card";
import { CollectionCard } from "@/components/cards/collection-card";
import { CatalogMedia } from "@/components/catalog-media";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";

function Intro({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return <div className="route-intro"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{body}</p></div>;
}

export function ProductsIndexPage({ locale }: { locale: Locale }) {
  const copy = getDictionary(locale).pages.products;
  return <main><Container><Intro eyebrow={copy.eyebrow} title={copy.title} body={copy.body} /><div className="category-grid-v3 route-grid">{getTopCategories().map((category) => <CategoryCard key={category.id} category={category} locale={locale} />)}</div></Container></main>;
}

export function CategoryPage({ locale, category }: { locale: Locale; category: Category }) {
  const copy = getDictionary(locale);
  const children = getCategoryChildren(category.id);
  const categoryProducts = getProductsForCategory(category.id);
  return <main><Container><div className="route-breadcrumb"><Link href={localizedPath(locale, "/products")}>{copy.nav.products}</Link><span aria-hidden="true">/</span><span>{category.name[locale]}</span></div><Intro eyebrow={copy.nav.products} title={category.name[locale]} body={category.shortDescription[locale]} />
    {children.length > 0 && <div className="category-grid-v3 route-grid">{children.map((child) => <CategoryCard key={child.id} category={child} locale={locale} />)}</div>}
    {categoryProducts.length > 0 && <div className="route-subsection"><h2>{copy.home.featured.title}</h2><div className="product-grid-v3">{categoryProducts.map((product) => <ProductCard key={product.id} product={product} locale={locale} />)}</div></div>}
    {children.length === 0 && categoryProducts.length === 0 && <p className="route-empty">{copy.common.noProducts}</p>}
  </Container></main>;
}

export function NewArrivalsPage({ locale }: { locale: Locale }) {
  const copy = getDictionary(locale).pages.newArrivals;
  return <main><Container><Intro eyebrow={copy.eyebrow} title={copy.title} body={copy.body} /><div className="product-grid-v3 route-grid">{getNewArrivals().map((product) => <ProductCard key={product.id} product={product} locale={locale} />)}</div></Container></main>;
}

export function ProductDetailPage({ locale, product }: { locale: Locale; product: Product }) {
  const copy = getDictionary(locale);
  return <main><Container className="detail-grid"><CatalogMedia visual={product.images[0]?.visual ?? "press-on"} image={product.images[0]} alt={product.images[0]?.alt[locale] ?? ""} /><div className="detail-copy"><p className="eyebrow">{copy.common.concept}</p><h1>{product.name[locale]}</h1><p>{product.description[locale]}</p><div className="detail-divider" /><p className="detail-note">{copy.home.featured.body}</p><Button href={localizedPath(locale, "/rfq")}>{copy.common.requestQuote}</Button></div></Container></main>;
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
