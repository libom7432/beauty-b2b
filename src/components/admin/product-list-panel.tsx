import { AdminBadge, AdminEmptyState, AdminErrorState, AdminLoadingState, AdminTable } from "./ui";
import type { AdminCategoryOptions, AdminProductListDTO } from "@/lib/catalog-read/types";
import type { AdminProductsUrlQuery } from "@/lib/admin/products-query";
import { adminProductsHref } from "@/lib/admin/products-query";
import { adminProductIdDetailHref } from "@/lib/admin/product-detail-navigation";
import { ProductListFilters } from "./product-list-filters";
import { GuardedAdminLink } from "./admin-unsaved-changes";

export type ProductListState = "not_connected" | "loading" | "empty" | "no_matches" |
  "success" | "source_unavailable" | "invalid_query";
const shown = (value: string | undefined) => value?.trim() || "Unavailable";
const shownDate = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "Unavailable";
};

export function ProductListPanel({ state, products = [], query, categories, categoryOptionsUnavailable = false,
  previousHref, nextHref, testData = false }: {
  state: ProductListState; products?: readonly AdminProductListDTO[];
  query?: AdminProductsUrlQuery; categories?: AdminCategoryOptions; categoryOptionsUnavailable?: boolean;
  previousHref?: string | null; nextHref?: string | null; testData?: boolean;
}) {
  const rows = state === "success" ? products : [];
  return <section className="admin-card admin-table-panel" aria-label="Product list">
    <div className="admin-table-top"><div><h2>Catalog products</h2><p>Product Code identifies a product family; Variant SKU identifies a purchasable specification.</p></div><div className="admin-table-badges">{testData && state === "success" && <AdminBadge tone="warning">TEST DATA</AdminBadge>}<AdminBadge>{state === "success" || state === "empty" || state === "no_matches" ? "Read only" : state === "loading" ? "Loading" : state === "source_unavailable" ? "Unavailable" : state === "invalid_query" ? "Invalid query" : "Not Connected"}</AdminBadge></div></div>
    {query && <ProductListFilters query={query} categories={categories}
      categoryOptionsUnavailable={categoryOptionsUnavailable} />}
    <AdminTable caption="Catalog products" headings={["Product Code", "Product Name", "Product Type", "Status", "Primary Category", "Variants", "Updated At"]}>
      {rows.map((row) => <tr key={row.productCode}>
        <td><GuardedAdminLink className="admin-inline-link" href={adminProductIdDetailHref(row.id,
          query ? adminProductsHref(query, query.cursor, query.direction, query.page) : "/admin/products")}>{row.productCode}</GuardedAdminLink></td>
        <td>{row.name.state === "available" ? shown(row.name.value) : "Unavailable"}</td>
        <td>{shown(row.productType)}</td><td><AdminBadge tone={row.status === "published" ? "positive" : row.status === "draft" ? "warning" : "neutral"}>{row.status}</AdminBadge></td>
        <td>{shown(row.primaryCategory?.name.en)}</td><td>{row.variantCount}</td><td>{shownDate(row.updatedAt)}</td>
      </tr>)}
      {rows.length === 0 && <tr><td colSpan={7}>
        {state === "loading" ? <AdminLoadingState /> : state === "source_unavailable" ? <AdminErrorState /> :
          <AdminEmptyState title={state === "not_connected" ? "Product database not connected" :
            state === "invalid_query" ? "Invalid product query" : state === "no_matches" ? "No Matching Products" : "No Products"}
            description={state === "not_connected" ? "Product data is not connected to this Admin interface." :
              state === "invalid_query" ? "Clear the filters and try again." :
              state === "no_matches" ? "Try another search or filter." : "The connected catalog returned no products."} />}
      </td></tr>}
    </AdminTable>
    {query && <nav className="admin-product-pagination" aria-label="Product pages">
      {previousHref ? <GuardedAdminLink href={previousHref}>Previous</GuardedAdminLink> : <span aria-disabled="true">Previous</span>}
      <span>Page {query.page}</span>
      {nextHref ? <GuardedAdminLink href={nextHref}>Next</GuardedAdminLink> : <span aria-disabled="true">Next</span>}
    </nav>}
  </section>;
}
