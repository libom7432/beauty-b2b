import { AdminCategoryTree } from "@/components/admin/admin-category-tree";
import { requireAdminPage } from "@/lib/admin/server-access";
import { createServerCatalogReadRepository } from "@/lib/catalog-read/server";
import { CatalogReadError } from "@/lib/catalog-read/errors";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export default async function AdminCategoriesPage() {
  await requireAdminPage("catalog.read");
  const repository = await createServerCatalogReadRepository();
  let result;
  try { result = await repository.listAdminCategories(); }
  catch (error) {
    if (error instanceof CatalogReadError && error.code === "FORBIDDEN") redirect("/admin/login?error=1");
    throw error;
  }
  return <AdminCategoryTree result={result} />;
}
