import { AdminBadge, AdminCard, AdminEmptyState, AdminErrorState, AdminTable } from "./ui";
import type { AdminVariantDTO, Availability, ProductTranslationRow } from "@/lib/catalog-read/types";
import type { AdminProductDetailView } from "@/lib/admin/product-detail-view";

const shown = (value: string | null | undefined) => value?.trim() || "Not Available";
const shownDate = (value: string | null) => {
  if (!value) return "Not Available";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "Not Available";
};
const statusTone = (status: string) => status === "published" ? "positive" : status === "draft" ? "warning" : "neutral";
const translationName = (value: Availability<ProductTranslationRow>) => value.state === "available"
  ? shown(value.value.name) : "Not Available";
const categoryName = (category: { name: { en: string; zh: string }; path: readonly string[] }) =>
  `${shown(category.name.en || category.name.zh)}${category.path.length ? ` · ${category.path.join(" / ")}` : ""}`;
const attributes = (variant: AdminVariantDTO) => Object.entries(variant.attributes).length
  ? Object.entries(variant.attributes).map(([key, value]) => `${key}: ${String(value)}`).join(" · ")
  : "Not Available";

export function ProductDetailPanel({ product, testData = false }: { product: AdminProductDetailView; testData?: boolean }) {
  const name = product.translations.en.state === "available" ? translationName(product.translations.en)
    : translationName(product.translations.zh);
  return <div className="admin-detail-grid" aria-label="Product detail information">
    {testData && <div className="admin-detail-wide"><AdminBadge tone="warning">TEST DATA</AdminBadge></div>}
    <AdminCard title="Basic Information"><dl className="admin-detail-list">
      <div><dt>Product Code</dt><dd>{product.basic.product_code}</dd></div>
      <div><dt>Product Name</dt><dd>{name}</dd></div>
      <div><dt>Product Type</dt><dd>{shown(product.basic.product_type)}</dd></div>
      <div><dt>Product Status</dt><dd><AdminBadge tone={statusTone(product.basic.status)}>{product.basic.status}</AdminBadge></dd></div>
      <div><dt>Created At</dt><dd>{shownDate(product.basic.created_at)}</dd></div>
      <div><dt>Updated At</dt><dd>{shownDate(product.basic.updated_at)}</dd></div>
    </dl></AdminCard>
    <AdminCard title="Translations"><div className="admin-detail-sections">
      {(["en", "zh"] as const).map((locale) => {
        const value = product.translations[locale];
        return <section key={locale} lang={locale}><h3>{locale === "en" ? "English" : "Chinese"}</h3>
          {value.state === "available" ? <dl className="admin-detail-list">
            <div><dt>Name</dt><dd>{shown(value.value.name)}</dd></div>
            <div><dt>Description</dt><dd>{shown(value.value.description)}</dd></div>
          </dl> : <p>Translation not available.</p>}</section>;
      })}
    </div></AdminCard>
    <AdminCard title="Categories"><dl className="admin-detail-list">
      <div><dt>Primary Category</dt><dd>{product.categories.primary ? categoryName(product.categories.primary) : "Not Available"}</dd></div>
      <div><dt>Additional Categories</dt><dd>{product.categories.additional.length
        ? product.categories.additional.map(categoryName).join("; ") : "Not Available"}</dd></div>
    </dl></AdminCard>
    <AdminCard title="Publishing Status"><dl className="admin-detail-list">
      <div><dt>Product Status</dt><dd>{product.publishing.status}</dd></div>
      <div><dt>Published At</dt><dd>{shownDate(product.publishing.publishedAt)}</dd></div>
    </dl></AdminCard>
    <AdminCard title="Variants" className="admin-detail-wide">
      {product.variants.length ? <AdminTable caption="Product variants" headings={["Variant SKU", "Attributes", "Variant Status"]}>
        {product.variants.map((variant) => <tr key={variant.id}>
          <td className="admin-detail-sku">{variant.sku}</td><td>{attributes(variant)}</td>
          <td><AdminBadge tone={statusTone(variant.status)}>{variant.status}</AdminBadge></td>
        </tr>)}
      </AdminTable> : <p>No variants available.</p>}
    </AdminCard>
    <AdminCard title="MOQ" className="admin-detail-wide">
      {product.variants.length ? <AdminTable caption="Variant minimum order quantities" headings={["Variant SKU", "Minimum Quantity", "Unit"]}>
        {product.variants.map((variant) => <tr key={variant.id}><td className="admin-detail-sku">{variant.sku}</td>
          <td>{variant.moq.quantity}</td><td>{shown(variant.moq.unit)}</td></tr>)}
      </AdminTable> : <p>Not Available</p>}
    </AdminCard>
    <AdminCard title="Reference Pricing" className="admin-detail-wide" description="Reference prices are not USD tiered prices.">
      {product.variants.length ? <AdminTable caption="Variant reference prices" headings={["Variant SKU", "Reference Price", "Currency"]}>
        {product.variants.map((variant) => <tr key={variant.id}><td className="admin-detail-sku">{variant.sku}</td>
          <td>{variant.referencePrice.kind === "not_provided" ? "Not Available" : variant.referencePrice.amount}</td>
          <td>{variant.referencePrice.kind === "not_provided" ? "Not Available" : variant.referencePrice.currency}</td></tr>)}
      </AdminTable> : <p>Not Available</p>}
      <p>Tiered pricing: {product.priceTiers.state === "unavailable" ? "Not Available" : "Available"}</p>
    </AdminCard>
    <AdminCard title="Product Images" className="admin-detail-wide" description="Image metadata only. Storage access is not connected.">
      {product.images.length ? <AdminTable caption="Product image metadata" headings={["Association", "Order", "Alt Text", "Status"]}>
        {product.images.map((image) => {
          const variant = product.variants.find((item) => item.id === image.variantId);
          return <tr key={image.id}><td>{image.variantId ? variant ? `Variant SKU: ${variant.sku}` : "Variant unavailable" : "Product"}</td>
            <td>{image.sortOrder}</td><td>{shown(image.alt.en || image.alt.zh)}</td>
            <td><AdminBadge tone={statusTone(image.status)}>{image.status}</AdminBadge></td></tr>;
        })}
      </AdminTable> : <p>No image metadata available.</p>}
    </AdminCard>
    <AdminCard title="SEO" className="admin-detail-wide"><dl className="admin-detail-list">
      <div><dt>Slug</dt><dd>{shown(product.basic.slug)}</dd></div>
      {(["en", "zh"] as const).map((locale) => <div key={locale}><dt>{locale === "en" ? "English" : "Chinese"} SEO</dt>
        <dd>{product.seo[locale].state === "available"
          ? `${shown(product.seo[locale].value.title)} · ${shown(product.seo[locale].value.description)}`
          : "Not Available"}</dd></div>)}
    </dl></AdminCard>
  </div>;
}

export function ProductDetailStatePanel({ state }: { state: "not_connected" | "not_found" | "source_unavailable" }) {
  return state === "source_unavailable" ? <AdminErrorState /> : <AdminEmptyState
    title={state === "not_connected" ? "Product database not connected" : "Product not found"}
    description={state === "not_connected" ? "The product source is not configured." :
      "The connected catalog has no product with this Product Code."} />;
}
