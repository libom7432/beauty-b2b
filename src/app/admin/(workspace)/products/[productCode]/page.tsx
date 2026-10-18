import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminBadge, AdminCard, AdminPageHeader } from "@/components/admin/ui";
import { requireAdminPage } from "@/lib/admin/server-access";

const areas = [
  ["Translations", "English and Chinese product content will appear here."],
  ["Categories", "Primary and secondary category assignments will appear here."],
  ["Variants", "Purchasable Variant SKUs and specifications will appear here."],
  ["MOQ", "Minimum order quantity is defined per Variant SKU."],
  ["Tiered Pricing", "USD price tiers belong to the purchasable variant."],
  ["Product Images", "Product and variant image references will appear here."],
  ["SEO", "Localized SEO fields will appear here."],
  ["Publishing Status", "Draft, published and retired status will appear here."],
] as const;

export const dynamic = "force-dynamic";
export default async function AdminProductDetail({ params }: { params: Promise<{ productCode: string }> }) {
  await requireAdminPage("catalog.read");
  const { productCode } = await params;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(productCode)) notFound();
  return <>
    <AdminPageHeader eyebrow="CATALOG / PRODUCTS / DETAIL" title="Product detail" description="Read-only structure for a product family. The requested code has not been looked up in a database."><AdminBadge>Not Connected</AdminBadge></AdminPageHeader>
    <p className="mb-5"><Link href="/admin/products" className="admin-inline-link">← Back to products</Link></p>
    <div className="admin-detail-grid">
      <AdminCard title="Basic Information" description="No verified product record is connected."><dl className="admin-detail-list"><div><dt>Requested Product Code</dt><dd>{productCode}</dd></div><div><dt>Product Name</dt><dd>Not Connected</dd></div><div><dt>Variant SKU</dt><dd>Not Connected</dd></div></dl></AdminCard>
      {areas.map(([title, description]) => <AdminCard key={title} title={title} description={description}><div className="admin-card-footer"><AdminBadge>Not Connected</AdminBadge><span className="admin-card-note">READ ONLY</span></div></AdminCard>)}
    </div>
  </>;
}
