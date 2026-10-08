import Link from "next/link";
import type { Locale } from "@/i18n/config";
import type { Product } from "@/lib/catalog/types";
import { getProductListingSummary } from "@/lib/catalog/products";
import { localizedPath } from "@/lib/site/paths";
import { getDictionary } from "@/i18n/dictionaries";
import { CatalogMedia } from "@/components/catalog-media";

const units: Record<string, string> = { sets: "套", packs: "包", boxes: "盒", bottles: "瓶", tubes: "支", units: "件" };

function purchaseUnit(locale: Locale, unit: string) {
  return locale === "zh" ? units[unit] ?? unit : unit;
}

export function ProductCard({ product, locale, listing = false }: { product: Product; locale: Locale; listing?: boolean }) {
  const href = localizedPath(locale, `/product/${product.slug}`);
  const copy = getDictionary(locale);
  const summary = listing ? getProductListingSummary(product) : undefined;
  return <article className={`product-card-v3${listing ? " product-card-listing" : ""}`}>
    <Link href={href} aria-label={listing ? `${copy.listing.viewDetails}: ${product.name[locale]}` : product.name[locale]} className="product-card-link">
      <div className="card-media-link"><CatalogMedia visual={product.images[0]?.visual ?? "press-on"} image={product.images[0]} alt={product.images[0]?.alt[locale] ?? ""} /></div>
      <div className="product-card-meta"><span>{product.isMock ? copy.common.concept : product.productCode}</span><span className="product-card-arrow" aria-hidden="true">↗</span></div>
      <h3>{product.name[locale]}</h3>
      <p>{product.shortDescription[locale]}</p>
      {listing && <>
        <dl className="product-card-terms">
          {summary && <div><dt>{copy.listing.moq}</dt><dd>{summary.moq.quantity} {purchaseUnit(locale, summary.moq.unit)}</dd></div>}
          {summary?.startingPrice && <div><dt>{copy.listing.fromPrice}</dt><dd>{summary.startingPrice.amount.toFixed(2)} / {purchaseUnit(locale, summary.startingPrice.unit)}</dd></div>}
        </dl>
        {(product.oemOdm.oem || product.oemOdm.odm) && <div className="product-card-capabilities">{product.oemOdm.oem && <span>OEM</span>}{product.oemOdm.odm && <span>ODM</span>}</div>}
        {product.isMock && <p className="product-card-disclaimer">{copy.listing.testData}</p>}
        <span className="product-card-view">{copy.listing.viewDetails} <span aria-hidden="true">↗</span></span>
      </>}
    </Link>
  </article>;
}
