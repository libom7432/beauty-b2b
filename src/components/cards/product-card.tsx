import Link from "next/link";
import type { Locale } from "@/i18n/config";
import type { Product } from "@/lib/catalog/types";
import { localizedPath } from "@/lib/site/paths";
import { getDictionary } from "@/i18n/dictionaries";
import { CatalogMedia } from "@/components/catalog-media";

export function ProductCard({ product, locale }: { product: Product; locale: Locale }) {
  const href = localizedPath(locale, `/product/${product.slug}`);
  return <article className="product-card-v3">
    <Link href={href} aria-label={product.name[locale]} className="product-card-link">
      <div className="card-media-link"><CatalogMedia visual={product.images[0]?.visual ?? "press-on"} image={product.images[0]} alt={product.images[0]?.alt[locale] ?? ""} /></div>
      <div className="product-card-meta"><span>{product.isMock ? getDictionary(locale).common.concept : product.sku}</span><span className="product-card-arrow" aria-hidden="true">↗</span></div>
      <h3>{product.name[locale]}</h3>
      <p>{product.shortDescription[locale]}</p>
    </Link>
  </article>;
}
