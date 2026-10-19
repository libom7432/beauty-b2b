import { AdminBadge, AdminPageHeader } from "@/components/admin/ui";
import { ProductListPanel } from "@/components/admin/product-list-panel";
import { requireAdminPage } from "@/lib/admin/server-access";
import { createServerCatalogReadRepository } from "@/lib/catalog-read/server";
import { loadAdminProductsList, type AdminProductsListState } from "@/lib/admin/products-list-state";
import { nextAdminProductsHref, parseAdminProductsUrl, previousAdminProductsHref } from "@/lib/admin/products-query";
import { CatalogReadError } from "@/lib/catalog-read/errors";
import type { AdminCategoryOptions } from "@/lib/catalog-read/types";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminProductsPage({ searchParams }: Props) {
  await requireAdminPage("catalog.read");
  let query;
  try { query = parseAdminProductsUrl(await searchParams); }
  catch (error) {
    if (!(error instanceof CatalogReadError) || error.code !== "INVALID_INPUT") throw error;
    return <>
      <AdminPageHeader eyebrow="CATALOG / PRODUCTS" title="Products" description="Browse product families and their variants."><AdminBadge>Invalid query</AdminBadge></AdminPageHeader>
      <ProductListPanel state="invalid_query" />
    </>;
  }
  const repository = await createServerCatalogReadRepository();
  let result: AdminProductsListState;
  let categories: AdminCategoryOptions = { items: [], hasMore: false };
  let categoryOptionsUnavailable = false;
  try {
    result = await loadAdminProductsList(repository, query.repositoryQuery);
  } catch (error) {
    if (error instanceof CatalogReadError && error.code === "FORBIDDEN") redirect("/admin/login?error=1");
    if (error instanceof CatalogReadError && error.code === "INVALID_INPUT")
      return <>
        <AdminPageHeader eyebrow="CATALOG / PRODUCTS" title="Products" description="Browse product families and their variants."><AdminBadge>Invalid query</AdminBadge></AdminPageHeader>
        <ProductListPanel state="invalid_query" />
      </>;
    result = { kind: "source_unavailable", products: [] };
  }
  if (result.kind !== "not_connected" && result.kind !== "source_unavailable") {
    try { categories = await repository.listAdminPrimaryCategoryOptions(); }
    catch (error) {
      if (error instanceof CatalogReadError && error.code === "FORBIDDEN") redirect("/admin/login?error=1");
      if (error instanceof CatalogReadError && error.code === "NOT_CONFIGURED")
        categoryOptionsUnavailable = true;
      else result = { kind: "source_unavailable", products: [] };
    }
  }
  const previousHref = result.kind === "success"
    ? previousAdminProductsHref(query, result.previousCursor) : null;
  const nextHref = result.kind === "success" ? nextAdminProductsHref(query, result.nextCursor) : null;
  return <>
    <AdminPageHeader eyebrow="CATALOG / PRODUCTS" title="Products" description="Browse product families and their variants when the product database is connected. No editing is available in this phase."><AdminBadge>{result.kind === "not_connected" ? "Not Connected" : result.kind === "source_unavailable" ? "Unavailable" : "Read only"}</AdminBadge></AdminPageHeader>
    <ProductListPanel state={result.kind} products={result.products} query={query}
      categories={categories} categoryOptionsUnavailable={categoryOptionsUnavailable}
      previousHref={previousHref} nextHref={nextHref} />
  </>;
}
