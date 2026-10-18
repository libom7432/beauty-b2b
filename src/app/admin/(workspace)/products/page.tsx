import { AdminBadge, AdminPageHeader } from "@/components/admin/ui";
import { ProductListPanel } from "@/components/admin/product-list-panel";
import { requireAdminPage } from "@/lib/admin/server-access";
import { createServerCatalogReadRepository } from "@/lib/catalog-read/server";
import { loadAdminProductsList } from "@/lib/admin/products-list-state";
import { CatalogReadError } from "@/lib/catalog-read/errors";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export default async function AdminProductsPage() {
  await requireAdminPage("catalog.read");
  const repository = await createServerCatalogReadRepository();
  let result;
  try { result = await loadAdminProductsList(repository); }
  catch (error) {
    if (error instanceof CatalogReadError && error.code === "FORBIDDEN") redirect("/admin/login?error=1");
    throw error;
  }
  return <>
    <AdminPageHeader eyebrow="CATALOG / PRODUCTS" title="Products" description="Browse product families and their variants when the product database is connected. No editing is available in this phase."><AdminBadge>{result.kind === "not_connected" ? "Not Connected" : result.kind === "source_unavailable" ? "Unavailable" : "Read only"}</AdminBadge></AdminPageHeader>
    <ProductListPanel state={result.kind} products={result.products} hasNextPage={result.kind === "success" && result.hasNextPage} />
  </>;
}
