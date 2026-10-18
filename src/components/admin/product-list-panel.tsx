import Link from "next/link";
import { AdminBadge, AdminEmptyState, AdminErrorState, AdminLoadingState, AdminTable } from "./ui";

export type AdminProductRow = Readonly<{
  productCode: string; name: string; category: string; status: string; variants: number; updatedAt: string;
}>;
export type ProductListState = "not_connected" | "loading" | "error" | "ready";

export function ProductListPanel({ state, products = [] }: { state: ProductListState; products?: readonly AdminProductRow[] }) {
  const rows = state === "ready" ? products : [];
  return <section className="admin-card admin-table-panel" aria-label="Product list">
    <div className="admin-table-top"><div><h2>Catalog products</h2><p>Product Code identifies a product family; Variant SKU identifies a purchasable specification.</p></div><AdminBadge>{state === "ready" ? "Read only" : state === "loading" ? "Loading" : state === "error" ? "Unavailable" : "Not Connected"}</AdminBadge></div>
    <AdminTable caption="Catalog products" headings={["Product Code", "Product Name", "Category", "Status", "Variants", "Updated At"]}>
      {rows.map((row) => <tr key={row.productCode}>
        <td><Link className="admin-inline-link" href={`/admin/products/${encodeURIComponent(row.productCode)}`}>{row.productCode}</Link></td>
        <td>{row.name}</td><td>{row.category}</td><td><AdminBadge>{row.status}</AdminBadge></td><td>{row.variants}</td><td>{row.updatedAt}</td>
      </tr>)}
      {rows.length === 0 && <tr><td colSpan={6}>
        {state === "loading" ? <AdminLoadingState /> : state === "error" ? <AdminErrorState /> : <AdminEmptyState title={state === "not_connected" ? "Product database not connected" : "No products found"} description={state === "not_connected" ? "Product data is not connected to this Admin interface." : "The connected catalog returned no products."} />}
      </td></tr>}
    </AdminTable>
  </section>;
}
