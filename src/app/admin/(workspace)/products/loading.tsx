import { AdminPageHeader } from "@/components/admin/ui";
import { ProductListPanel } from "@/components/admin/product-list-panel";

/** Next.js route-segment fallback; the workspace layout still gates access. */
export default function LoadingAdminProducts() {
  return <>
    <AdminPageHeader eyebrow="CATALOG / PRODUCTS" title="Products" description="Loading the product list." />
    <ProductListPanel state="loading" />
  </>;
}
