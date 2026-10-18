import { AdminPlaceholder } from "@/components/admin/admin-placeholder";
import { requireAdminPage } from "@/lib/admin/server-access";

export const dynamic = "force-dynamic";
export default async function AdminMediaPage() {
  await requireAdminPage("catalog.read");
  return <AdminPlaceholder title="Media" eyebrow="CATALOG / MEDIA" description="A future read-only view of product image references. Upload and deletion are unavailable." dataSource="Product image storage" />;
}
