import { AdminPlaceholder } from "@/components/admin/admin-placeholder";
import { requireAdminPage } from "@/lib/admin/server-access";

export const dynamic = "force-dynamic";
export default async function AdminImportsPage() {
  await requireAdminPage("catalog.import.receipt.read");
  return <AdminPlaceholder title="Imports" eyebrow="CATALOG / IMPORTS" description="A future read-only view of catalog import receipts. Preview and commit actions are unavailable." dataSource="The import receipt service" />;
}
