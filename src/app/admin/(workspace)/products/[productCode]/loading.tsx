import { AdminPageHeader } from "@/components/admin/ui";

/** Route-segment fallback; the workspace layout retains its server authorization. */
export default function LoadingAdminProductDetail() {
  return <>
    <AdminPageHeader eyebrow="CATALOG / PRODUCTS / DETAIL" title="Product detail" description="Loading product details." />
    <div className="admin-state" role="status"><strong>Loading product detail</strong><p>Waiting for the product source.</p></div>
  </>;
}
