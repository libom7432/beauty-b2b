"use client";

import { useState } from "react";
import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import type { AttributeValue, Product, ProductVariant } from "@/lib/catalog/types";
import { attributeDefinitions } from "@/lib/catalog/taxonomy";
import { localizedPath } from "@/lib/site/paths";
import { CatalogMedia } from "@/components/catalog-media";
import { Button } from "@/components/ui/button";

const unitNames: Record<string, { en: string; singular: string; zh: string }> = {
  sets: { en: "sets", singular: "set", zh: "套" },
  packs: { en: "packs", singular: "pack", zh: "包" },
  boxes: { en: "boxes", singular: "box", zh: "盒" },
  bottles: { en: "bottles", singular: "bottle", zh: "瓶" },
  tubes: { en: "tubes", singular: "tube", zh: "支" },
  units: { en: "units", singular: "unit", zh: "件" },
  nails: { en: "nails", singular: "nail", zh: "片甲片" },
  tips: { en: "tips", singular: "tip", zh: "片甲片" },
  "nail files": { en: "nail files", singular: "nail file", zh: "片甲锉" },
  brushes: { en: "brushes", singular: "brush", zh: "支刷具" },
  foils: { en: "foils", singular: "foil", zh: "张转印箔" },
  rhinestones: { en: "rhinestones", singular: "rhinestone", zh: "颗水钻" },
};

function quantity(locale: Locale, count: number, unit: string) {
  const label = unitNames[unit];
  return locale === "zh" ? `${count} ${label?.zh ?? unit}` : `${count} ${label?.en ?? unit}`;
}

function priceUnit(locale: Locale, unit: string) {
  const label = unitNames[unit];
  return locale === "zh" ? label?.zh ?? unit : label?.singular ?? unit;
}

function attributeValue(locale: Locale, value: AttributeValue) {
  if (typeof value === "boolean") return value ? (locale === "zh" ? "是" : "Yes") : (locale === "zh" ? "否" : "No");
  return Array.isArray(value) ? value.join(", ") : String(value);
}

function variantLabel(locale: Locale, variant: ProductVariant) {
  const values = Object.values(variant.attributes).map((value) => attributeValue(locale, value));
  if (variant.packageContents) values.push(quantity(locale, variant.packageContents.quantity, variant.packageContents.unit));
  return values.join(" · ") || variant.sku;
}

export function ProductDetailPanel({ product, locale }: { product: Product; locale: Locale }) {
  const copy = getDictionary(locale).detail;
  const primaryIndex = Math.max(0, product.images.findIndex((image) => image.role === "primary"));
  const initialVariant = product.variants.find((variant) => variant.pricing.tiers.length > 0) ?? product.variants[0];
  const [variantId, setVariantId] = useState(initialVariant?.id);
  const [imageIndex, setImageIndex] = useState(initialVariant?.imageIndex ?? primaryIndex);
  const selected = product.variants.find((variant) => variant.id === variantId) ?? initialVariant;
  if (!selected) return null;
  const image = product.images[imageIndex] ?? product.images[primaryIndex];
  const sharedAttributes = Object.entries(product.attributes);
  const variantAttributes = Object.entries(selected.attributes).filter(([key]) => !(key in product.attributes));
  const attributeLabel = (key: string) => attributeDefinitions.find((definition) => definition.key === key)?.label[locale]
    ?? copy.extraAttributes[key as keyof typeof copy.extraAttributes]
    ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
  const chooseVariant = (variant: ProductVariant) => {
    setVariantId(variant.id);
    setImageIndex(variant.imageIndex !== undefined && product.images[variant.imageIndex] ? variant.imageIndex : primaryIndex);
  };

  return <>
    <div className="product-detail-grid">
      <section className="product-gallery" aria-label={copy.gallery}>
        <div className="product-gallery-main" role={image?.isPlaceholder && !image.src ? "img" : undefined} aria-label={image?.isPlaceholder && !image.src ? image.alt[locale] : undefined}>
          <CatalogMedia visual={image?.visual ?? product.images[primaryIndex]?.visual ?? "press-on"} image={image} alt={image?.alt[locale] ?? ""} sizes="(max-width: 900px) 100vw, 50vw" />
          {image?.isPlaceholder && <span className="product-gallery-badge">{copy.placeholder}</span>}
        </div>
        {product.images.length > 1 && <div className="product-gallery-thumbnails" aria-label={copy.galleryImages}>
          {product.images.map((item, index) => <button type="button" key={item.id} className="product-gallery-thumb" aria-label={`${copy.viewImage} ${index + 1}: ${item.alt[locale]}`} aria-pressed={index === imageIndex} onClick={() => setImageIndex(index)}>
            <CatalogMedia visual={item.visual} image={item} alt="" sizes="100px" />
          </button>)}
        </div>}
      </section>

      <div className="product-detail-info">
        <p className="eyebrow">{copy.eyebrow}</p>
        <h1>{product.name[locale]}</h1>
        <p className="product-detail-code">{copy.productCode}: {product.productCode}</p>
        <p className="product-detail-description">{product.description[locale]}</p>

        <section className="product-detail-section" aria-label={copy.selectVariant}>
          <h2>{copy.selectVariant}</h2>
          <div className="product-variant-options">
            {product.variants.map((variant) => <button type="button" key={variant.id} className="product-variant-option" aria-pressed={variant.id === selected.id} onClick={() => chooseVariant(variant)}>
              <span>{variantLabel(locale, variant)}</span><small>{variant.sku}</small>
            </button>)}
          </div>
          <dl className="product-variant-facts">
            <div><dt>SKU</dt><dd>{selected.sku}</dd></div>
            <div><dt>{copy.wholesaleMoq}</dt><dd>{quantity(locale, selected.moq.quantity, selected.moq.unit)}</dd></div>
            {selected.moq.note && <div><dt>{copy.note}</dt><dd>{selected.moq.note[locale]}</dd></div>}
          </dl>
        </section>

        <section className="product-detail-section" aria-label={copy.wholesalePricing}>
          <div className="product-detail-heading"><h2>{copy.wholesalePricing}</h2><span>{copy.demoPricing}</span></div>
          <div className="product-price-table-wrap"><table className="product-price-table"><thead><tr><th scope="col">{copy.quantity}</th><th scope="col">{copy.unitPrice}</th></tr></thead><tbody>
            {selected.pricing.tiers.map((tier) => <tr key={tier.minQuantity}><td>{quantity(locale, tier.minQuantity, selected.moq.unit)}</td><td>USD {tier.unitPriceUsd.toFixed(2)} / {priceUnit(locale, selected.moq.unit)}</td></tr>)}
          </tbody></table></div>
          <p className="product-detail-note">{copy.demoNote}</p>
        </section>

        <Button href={localizedPath(locale, "/contact")} className="product-detail-quote">{getDictionary(locale).common.requestQuote}</Button>
        <p className="product-detail-note">{copy.quoteNote}</p>
      </div>
    </div>

    <div className="product-detail-lower">
      <section className="product-detail-block" aria-labelledby="product-customization-title">
        <h2 id="product-customization-title">{copy.customization}</h2>
        <div className="product-capability-tags">{product.oemOdm.oem && <span>OEM</span>}{product.oemOdm.odm && <span>ODM</span>}</div>
        {product.oemOdm.note && <p>{product.oemOdm.note[locale]}</p>}
        <p>{copy.customMoqNote}</p>
        {product.customizationOptions.length > 0 && <ul className="product-customization-list">{product.customizationOptions.map((option) => <li key={option.id}><span>{option.name[locale]}</span><strong>{option.moq ? `${copy.customMoq}: ${quantity(locale, option.moq.quantity, option.moq.unit)}` : copy.customMoqAsk}</strong>{option.moq?.note && <small>{option.moq.note[locale]}</small>}</li>)}</ul>}
      </section>
      <section className="product-detail-block" aria-labelledby="product-specifications-title">
        <h2 id="product-specifications-title">{copy.specifications}</h2>
        {sharedAttributes.length > 0 && <><h3>{copy.sharedAttributes}</h3><dl className="product-spec-list">{sharedAttributes.map(([key, value]) => <div key={key}><dt>{attributeLabel(key)}</dt><dd>{attributeValue(locale, value)}</dd></div>)}</dl></>}
        {(variantAttributes.length > 0 || selected.packageContents) && <><h3>{copy.variantAttributes}</h3><dl className="product-spec-list">{variantAttributes.map(([key, value]) => <div key={key}><dt>{attributeLabel(key)}</dt><dd>{attributeValue(locale, value)}</dd></div>)}{selected.packageContents && <div><dt>{copy.packageContents}</dt><dd>{quantity(locale, selected.packageContents.quantity, selected.packageContents.unit)} / {priceUnit(locale, selected.moq.unit)}</dd></div>}</dl></>}
      </section>
    </div>
  </>;
}
