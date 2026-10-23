import { AdminBadge, AdminCard, AdminTable } from "./ui";
import { GuardedAdminLink } from "./admin-unsaved-changes";
import { collectionMemberHref } from "@/lib/admin/collection-detail-query";
import type { AdminCollectionDetailResult, AdminCollectionMemberListResult } from "@/lib/catalog-read/types";

const shown = (value: string | null | undefined) => value?.trim() || "Not provided";
const tone = (status: string) => status === "published" ? "positive" : status === "draft" ? "warning" : "neutral";

const detailStates = {
  NOT_CONNECTED: ["Collections database not connected", "The read-only collection source is not connected."],
  NOT_FOUND: ["Collection not found", "No collection exists for this UUID in the connected source."],
  INCOMPLETE: ["Collection detail incomplete", "The source could not prove this collection detail is complete."],
  ERROR: ["Collection unavailable", "The collection detail could not be read. Try again later."],
  EMPTY_PAGE: ["Collection detail unavailable", "The collection detail could not be read."],
} as const;

const memberStates = {
  INVALID_CURSOR: ["Invalid member cursor", "The member cursor is invalid. Return to the first member page."],
  NOT_CONNECTED: ["Members database not connected", "The read-only member source is not connected."],
  NOT_FOUND: ["Member collection unavailable", "The member source no longer finds this collection. Refresh the detail."],
  INCOMPLETE: ["Member data incomplete", "The source could not prove this member page is complete."],
  ERROR: ["Members unavailable", "The associated products could not be read. Try again later."],
  EMPTY_PAGE: ["No members beyond this cursor", "This page is empty. Use the recovery link to return."],
} as const;

export function CollectionDetailPanel({ detail, members, invalidMemberCursor = false }: {
  detail: AdminCollectionDetailResult;
  members: AdminCollectionMemberListResult | null;
  invalidMemberCursor?: boolean;
}) {
  if (detail.state !== "COMPLETE" || !detail.item) {
    const [title, description] = detailStates[detail.state === "COMPLETE" ? "ERROR" : detail.state];
    return <div className="admin-card admin-collection-state" role={detail.state === "ERROR" || detail.state === "INCOMPLETE" ? "alert" : "status"}>
      <h2>{title}</h2><p>{description}</p></div>;
  }
  const item = detail.item;
  const memberState = invalidMemberCursor ? "INVALID_CURSOR" : members?.state ?? "ERROR";
  const rows = memberState === "COMPLETE" ? members?.items ?? [] : [];
  const previous = (memberState === "COMPLETE" || memberState === "EMPTY_PAGE") ? members?.previousCursor : null;
  const next = (memberState === "COMPLETE" || memberState === "EMPTY_PAGE") ? members?.nextCursor : null;
  return <section className="admin-detail-grid" aria-label="Collection detail information">
    {detail.origin === "OFFLINE_FIXTURE" && <div className="admin-detail-wide"><AdminBadge tone="warning">TEST DATA</AdminBadge></div>}
    <AdminCard title="Collection information"><dl className="admin-detail-list">
      <div><dt>Collection UUID</dt><dd>{item.id}</dd></div>
      <div><dt>Slug</dt><dd>{item.slug}</dd></div>
      <div><dt>Status</dt><dd><AdminBadge tone={tone(item.status)}>{item.status}</AdminBadge></dd></div>
      <div><dt>Sort order</dt><dd>{item.sortOrder}</dd></div>
      <div><dt>Created at</dt><dd><time dateTime={item.createdAt}>{item.createdAt}</time></dd></div>
      <div><dt>Updated at</dt><dd><time dateTime={item.updatedAt}>{item.updatedAt}</time></dd></div>
      <div><dt>Published at</dt><dd>{item.publishedAt
        ? <time dateTime={item.publishedAt}>{item.publishedAt}</time> : "Not published"}</dd></div>
    </dl></AdminCard>
    <AdminCard title="Names and descriptions"><dl className="admin-detail-list">
      <div><dt>English name</dt><dd lang="en">{shown(item.nameEn)}</dd></div>
      <div><dt>Chinese name</dt><dd lang="zh">{shown(item.nameZh)}</dd></div>
      <div><dt>English description</dt><dd lang="en">{shown(item.descriptionEn)}</dd></div>
      <div><dt>Chinese description</dt><dd lang="zh">{shown(item.descriptionZh)}</dd></div>
    </dl></AdminCard>
    <section className="admin-card admin-table-panel admin-detail-wide" aria-label="Associated products">
      <div className="admin-table-top"><div><h2>Associated products</h2>
        <p>Read-only, bounded member pages. Draft products remain visible to administrators.</p></div>
        <AdminBadge>{memberState === "INVALID_CURSOR" ? "Invalid cursor" : memberState}</AdminBadge></div>
      {memberState === "COMPLETE" ? <AdminTable caption="Associated collection products"
        headings={["Product UUID", "Product Code", "Product Name", "Product Status", "Sort order"]}>
        {rows.map((member) => <tr key={member.productId}>
          <td>{member.productId}</td><td>{shown(member.productCode)}</td>
          <td><span lang="en">{shown(member.nameEn)}</span><br /><span lang="zh">{shown(member.nameZh)}</span></td>
          <td><AdminBadge tone={tone(member.productStatus ?? "")}>{member.productStatus ?? "Unknown"}</AdminBadge></td>
          <td>{member.sortOrder}</td>
        </tr>)}
        {rows.length === 0 && <tr><td colSpan={5}>No associated products on this page.</td></tr>}
      </AdminTable> : <div className="admin-collection-state"
        role={memberState === "ERROR" || memberState === "INCOMPLETE" || memberState === "INVALID_CURSOR" ? "alert" : "status"}>
        <h3>{memberStates[memberState][0]}</h3><p>{memberStates[memberState][1]}</p>
        {memberState === "INVALID_CURSOR" && <GuardedAdminLink href={`/admin/collections/${item.id}`}>First member page</GuardedAdminLink>}
      </div>}
      <nav className="admin-product-pagination" aria-label="Collection member pages">
        {previous ? <GuardedAdminLink href={collectionMemberHref(item.id, previous, "before")}>Previous</GuardedAdminLink>
          : <span aria-disabled="true">Previous</span>}
        {next ? <GuardedAdminLink href={collectionMemberHref(item.id, next)}>Next</GuardedAdminLink>
          : <span aria-disabled="true">Next</span>}
      </nav>
    </section>
  </section>;
}
