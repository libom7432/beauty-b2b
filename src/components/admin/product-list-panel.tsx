import Link from "next/link";
import { AdminBadge, AdminEmptyState, AdminErrorState, AdminLoadingState, AdminTable } from "./ui";
import type { AdminProductListDTO } from "@/lib/catalog-read/types";

export type ProductListState = "not_connected" | "loading" | "empty" | "success" | "source_unavailable";
const shown = (value: string | undefined) => value?.trim() || "Unavailable";
const shownDate = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "Unavailable";
};

export function ProductListPanel({ state, products = [], hasNextPage = false, testData = false }: {
  state: ProductListState; products?: readonly AdminProductListDTO[]; hasNextPage?: boolean; testData?: boolean;
}) {
  const rows = state === "success" ? products : [];
  return <section className="admin-card admin-table-panel" aria-label="Product list">
    <div className="admin-table-top"><div><h2>Catalog products</h2><p>Product Code identifies a product family; Variant SKU identifies a purchasable specification.</p></div><div className="admin-table-badges">{testData && <AdminBadge tone="warning">TEST DATA</AdminBadge>}<AdminBadge>{state === "success" || state === "empty" ? "Read only" : state === "loading" ? "Loading" : state === "source_unavailable" ? "Unavailable" : "Not Connected"}</AdminBadge></div></div>
    <AdminTable caption="Catalog products" headings={["Product Code", "Product Name", "Product Type", "Status", "Primary Category", "Variants", "Updated At"]}>
      {rows.map((row) => <tr key={row.productCode}>
        <td><Link className="admin-inline-link" href={`/admin/products/${encodeURIComponent(row.productCode)}`}>{row.productCode}</Link></td>
        <td>{row.name.state === "available" ? shown(row.name.value) : "Unavailable"}</td>
        <td>{shown(row.productType)}</td><td><AdminBadge tone={row.status === "published" ? "positive" : row.status === "draft" ? "warning" : "neutral"}>{row.status}</AdminBadge></td>
        <td>{shown(row.primaryCategory?.name.en)}</td><td>{row.variantCount}</td><td>{shownDate(row.updatedAt)}</td>
      </tr>)}
      {rows.length === 0 && <tr><td colSpan={7}>
        {state === "loading" ? <AdminLoadingState /> : state === "source_unavailable" ? <AdminErrorState /> : <AdminEmptyState title={state === "not_connected" ? "Product database not connected" : "No Products"} description={state === "not_connected" ? "Product data is not connected to this Admin interface." : "The connected catalog returned no products."} />}
      </td></tr>}
    </AdminTable>
    {state === "success" && hasNextPage && <p className="admin-table-page-note">Showing the first page. More products are available.</p>}
  </section>;
}
