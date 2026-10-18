import { AdminPlaceholder } from "@/components/admin/admin-placeholder";
import { requireAdminPage } from "@/lib/admin/server-access";

export const dynamic = "force-dynamic";
export default async function AdminCategoriesPage() {
  await requireAdminPage("catalog.read");
  return <AdminPlaceholder title="Categories" eyebrow="CATALOG / CATEGORIES" description="A future read-only view of the storefront category hierarchy." dataSource="The category database" />;
}
