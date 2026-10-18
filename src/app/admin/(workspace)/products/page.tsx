import { AdminBadge, AdminPageHeader } from "@/components/admin/ui";
import { ProductListPanel } from "@/components/admin/product-list-panel";
import { requireAdminPage } from "@/lib/admin/server-access";

export const dynamic = "force-dynamic";
export default async function AdminProductsPage() {
  await requireAdminPage("catalog.read");
  return <>
    <AdminPageHeader eyebrow="CATALOG / PRODUCTS" title="Products" description="Browse product families and their variants when the product database is connected. No editing is available in this phase."><AdminBadge>Not Connected</AdminBadge></AdminPageHeader>
    <ProductListPanel state="not_connected" />
  </>;
}
