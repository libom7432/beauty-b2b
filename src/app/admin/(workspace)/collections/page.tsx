import { AdminPlaceholder } from "@/components/admin/admin-placeholder";
import { requireAdminPage } from "@/lib/admin/server-access";

export const dynamic = "force-dynamic";
export default async function AdminCollectionsPage() {
  await requireAdminPage("catalog.read");
  return <AdminPlaceholder title="Collections" eyebrow="CATALOG / COLLECTIONS" description="A future read-only view of curated product collections." dataSource="The collection database" />;
}
