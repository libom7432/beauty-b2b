import Link from "next/link";
import { AdminBadge, AdminEmptyState, AdminTable } from "./ui";
import { adminCollectionsHref, type AdminCollectionsUrlQuery } from "@/lib/admin/collections-query";
import type { AdminCollectionListResult } from "@/lib/catalog-read/types";

type PanelState = AdminCollectionListResult["state"] | "INVALID_QUERY";
const stateMessage: Record<Exclude<PanelState, "COMPLETE">, { title: string; description: string }> = {
  NOT_CONNECTED: { title: "Collections database not connected",
    description: "Collections 数据源尚未连接，当前无法读取真实集合数据。" },
  ERROR: { title: "Collections unavailable", description: "The collection source could not be read. Try again later." },
  INCOMPLETE: { title: "Collection data incomplete",
    description: "The source could not prove this page is complete. No navigation is available." },
  EMPTY_PAGE: { title: "No records beyond this cursor",
    description: "The collection page is empty. Use the available recovery link to return." },
  NOT_FOUND: { title: "Collection not found", description: "The requested collection is unavailable." },
  INVALID_QUERY: { title: "Invalid collection query",
    description: "The filter or cursor is invalid. Clear the filter to start again." },
};

export function CollectionListPanel({ result, query }: {
  result: AdminCollectionListResult | null; query: AdminCollectionsUrlQuery | null;
}) {
  const state: PanelState = result?.state ?? "INVALID_QUERY";
  const rows = state === "COMPLETE" ? result?.items ?? [] : [];
  const next = (state === "COMPLETE" || state === "EMPTY_PAGE") && result?.nextCursor && query
    ? adminCollectionsHref(query.status, result.nextCursor) : null;
  const previous = (state === "COMPLETE" || state === "EMPTY_PAGE") && result?.previousCursor && query
    ? adminCollectionsHref(query.status, result.previousCursor, "before") : null;
  const label = state === "COMPLETE" ? "Read only" : state === "NOT_CONNECTED" ? "Not Connected" :
    state === "INVALID_QUERY" ? "Invalid query" : state === "ERROR" ? "Unavailable" : state;
  return <section className="admin-card admin-table-panel" aria-label="Collection list">
    <div className="admin-table-top"><div><h2>Catalog collections</h2>
      <p>Manually curated collections. Product counts are unavailable from this read-only list.</p>
    </div><div className="admin-table-badges">
      {result?.origin === "OFFLINE_FIXTURE" && <AdminBadge tone="warning">TEST DATA</AdminBadge>}
      <AdminBadge>{label}</AdminBadge>
    </div></div>
    {query && <form action="/admin/collections" method="get" className="admin-collection-filters">
      <label>Status <select name="status" defaultValue={query.status} aria-label="Collection status">
        <option value="all">All statuses</option><option value="draft">Draft</option>
        <option value="published">Published</option><option value="retired">Retired</option>
      </select></label>
      <button type="submit">Apply filter</button>
      <Link href="/admin/collections">Clear filters</Link>
      <p>Name and Slug search is unavailable until a bounded server-side query is approved.</p>
    </form>}
    <AdminTable caption="Catalog collections" headings={["Collection", "Slug", "Status", "Sort order", "Updated", "Details"]}>
      {rows.map((row) => <tr key={row.id}>
        <td><strong>{row.nameEn.trim() || "Unnamed"}</strong><br />{row.nameZh.trim() || "—"}</td>
        <td>{row.slug}</td>
        <td><AdminBadge tone={row.status === "published" ? "positive" : row.status === "draft" ? "warning" : "neutral"}>{row.status}</AdminBadge></td>
        <td>{row.sortOrder}</td><td><time dateTime={row.updatedAt}>{row.updatedAt.slice(0, 10)}</time></td>
        <td><details className="admin-collection-details"><summary>View details for {row.nameEn.trim() || row.slug}</summary>
          <dl><div><dt>Collection ID</dt><dd>{row.id}</dd></div>
            <div><dt>Chinese name</dt><dd>{row.nameZh.trim() || "Unavailable"}</dd></div>
            <div><dt>Published at</dt><dd>{row.publishedAt?.slice(0, 10) || "Not published"}</dd></div></dl>
          <p>Read-only list information. Full collection details are not connected.</p>
        </details></td>
      </tr>)}
      {rows.length === 0 && <tr><td colSpan={6}>
        {state === "COMPLETE" ? <AdminEmptyState title="No collections"
          description={query?.status !== "all" ? "No collections match this status." : "The connected source returned no collections."} /> :
          <div className="admin-collection-state" role={state === "ERROR" || state === "INCOMPLETE" || state === "INVALID_QUERY" ? "alert" : "status"}>
            <h3>{stateMessage[state].title}</h3><p>{stateMessage[state].description}</p>
            {state === "INVALID_QUERY" && <Link href="/admin/collections">Start from first page</Link>}
          </div>}
      </td></tr>}
    </AdminTable>
    {query && <nav className="admin-product-pagination" aria-label="Collection pages">
      {previous ? <Link href={previous}>Previous</Link> : <span aria-disabled="true">Previous</span>}
      {next ? <Link href={next}>Next</Link> : <span aria-disabled="true">Next</span>}
    </nav>}
  </section>;
}
