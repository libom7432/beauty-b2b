import { notFound, redirect } from "next/navigation";
import { GuardedAdminLink } from "@/components/admin/admin-unsaved-changes";
import { ProductEditor } from "@/components/admin/product-editor";
import { AdminBadge, AdminPageHeader } from "@/components/admin/ui";
import { ProductDetailPanel, ProductDetailStatePanel } from "@/components/admin/product-detail-panel";
import { safeProductsReturnHref } from "@/lib/admin/product-detail-navigation";
import { loadAdminProductDetail } from "@/lib/admin/product-detail-state";
import { toAdminProductDetailView } from "@/lib/admin/product-detail-view";
import { requireAdminPage } from "@/lib/admin/server-access";
import { CatalogReadError } from "@/lib/catalog-read/errors";
import { createServerCatalogReadRepository } from "@/lib/catalog-read/server";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ productCode: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminProductDetail({ params, searchParams }: Props) {
  await requireAdminPage("catalog.read");
  const { productCode } = await params;
  const returnHref = safeProductsReturnHref((await searchParams).returnTo);
  const repository = await createServerCatalogReadRepository();
  let state;
  try { state = await loadAdminProductDetail(repository, productCode); }
  catch (error) {
    if (error instanceof CatalogReadError && error.code === "FORBIDDEN") redirect("/admin/login?error=1");
    if (error instanceof CatalogReadError && error.code === "INVALID_INPUT") notFound();
    throw error;
  }
  return <>
    <AdminPageHeader eyebrow="CATALOG / PRODUCTS / DETAIL" title="Product detail"
      description={state.kind === "success"
        ? "Catalog data is read only. This page offers a local draft editor; changes are never saved to the server."
        : "Read-only product family information from the connected Catalog source."}>
      <AdminBadge tone={state.kind === "success" ? "positive" : state.kind === "source_unavailable" ? "warning" : "neutral"}>
        {state.kind === "success" ? "Local draft only" : state.kind === "not_connected" ? "Not Connected" :
          state.kind === "not_found" ? "Not Found" : "Unavailable"}
      </AdminBadge>
    </AdminPageHeader>
    <p className="mb-5"><GuardedAdminLink href={returnHref} className="admin-inline-link">← Back to Products</GuardedAdminLink></p>
    {state.kind === "success" ? <><ProductDetailPanel product={toAdminProductDetailView(state.product)} />
      <ProductEditor key={state.product.basic.id} product={toAdminProductDetailView(state.product)} /></> :
      <ProductDetailStatePanel state={state.kind} />}
  </>;
}
