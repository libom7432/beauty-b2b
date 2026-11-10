import Link from "next/link";
import { AdminBadge, AdminCard, AdminEmptyState, AdminTable } from "./ui";
import type { RFQInboxDetail, RFQInboxPage } from "@/lib/rfq/inbox";

export type RFQInboxViewState = "loading" | "not_connected" | "unavailable" | "invalid" | "unauthorized";
const moqLabel = (value: boolean | null) => value === true ? "Below MOQ" :
  value === null ? "Historical MOQ unknown" : "At or above MOQ";

export function RFQInboxListPanel({ result, state, demo = false }: {
  result?: RFQInboxPage; state?: RFQInboxViewState; demo?: boolean;
}) {
  return <section className="admin-card admin-table-panel" aria-label="RFQ inbox">
    <div className="admin-table-top"><div><h2>Merchant inquiries</h2><p>Read-only requests, ordered newest first.</p></div>
      <AdminBadge tone={demo ? "warning" : "neutral"}>{demo ? "SYNTHETIC DATA" : "Read only"}</AdminBadge></div>
    {state ? <div className="admin-rfq-state" role={state === "unavailable" || state === "unauthorized" ? "alert" : "status"}>
      {state === "loading" ? "Loading inquiries…" : state === "not_connected" ? "RFQ data source not connected." :
        state === "unauthorized" ? "You do not have permission to read inquiries." :
          state === "invalid" ? "Invalid inbox page." : "Inquiries are temporarily unavailable."}
    </div> : result && result.items.length === 0 ?
      <AdminEmptyState title="No inquiries" description="No inquiries are available on this page." /> : result ? <>
      <AdminTable caption="Merchant inquiries" headings={["RFQ", "Received", "Status", "Company", "MOQ", "Open"]}>
        {result.items.map((row) => <tr key={row.id}><td>{row.rfqNumber}</td><td>{row.createdAt.slice(0, 16).replace("T", " ")} UTC</td>
          <td>{row.status}</td><td>{row.companyName}</td><td>{moqLabel(row.hasBelowMoq)}</td>
          <td><Link className="admin-inline-link" href={`/admin/rfq/${row.id}`}>View details</Link></td></tr>)}
      </AdminTable>
      <nav className="admin-product-pagination" aria-label="RFQ pages">
        {result.page > 1 ? <Link href={`/admin/rfq?page=${result.page - 1}`}>Previous</Link> : <span aria-disabled="true">Previous</span>}
        <span>Page {result.page}</span>
        {result.hasMore ? <Link href={`/admin/rfq?page=${result.page + 1}`}>Next</Link> : <span aria-disabled="true">Next</span>}
      </nav></> : null}
  </section>;
}

export function RFQInboxDetailPanel({ detail, demo = false }: { detail: RFQInboxDetail; demo?: boolean }) {
  return <div className="admin-rfq-detail">
    <AdminCard title="Inquiry" description="Stored request details. No changes can be made here.">
      {demo && <p><AdminBadge tone="warning">SYNTHETIC DATA</AdminBadge></p>}
      <dl className="admin-rfq-fields"><div><dt>RFQ</dt><dd>{detail.rfqNumber}</dd></div>
        <div><dt>Received</dt><dd>{detail.createdAt}</dd></div><div><dt>Status</dt><dd>{detail.status}</dd></div>
        <div><dt>Company</dt><dd>{detail.companyName}</dd></div><div><dt>Contact</dt><dd>{detail.fullName}</dd></div>
        <div><dt>Email</dt><dd>{detail.email}</dd></div><div><dt>WhatsApp</dt><dd>{detail.whatsapp ?? "Not provided"}</dd></div>
        <div><dt>Country</dt><dd>{detail.country}</dd></div><div><dt>Requirements</dt><dd>{detail.requirements}</dd></div></dl>
    </AdminCard>
    <AdminCard title="Requested products">
      <div className="admin-table-scroll"><table className="admin-table"><caption className="sr-only">Requested products</caption>
        <thead><tr><th scope="col">Product</th><th scope="col">SKU / Variant</th><th scope="col">Quantity</th><th scope="col">MOQ at submission</th></tr></thead>
        <tbody>{detail.items.map((item, index) => <tr key={`${item.productId}:${item.sku ?? index}`}>
          <td>{item.productName}</td><td>{item.sku ?? "—"}<small className="admin-rfq-variant">{item.variantId ?? "No variant"}</small></td>
          <td>{item.quantity}</td><td>{item.moqAtSubmission === null ? "Historical MOQ unknown" :
            <>{item.moqAtSubmission} {item.moqUnitAtSubmission} · <strong>{moqLabel(item.belowMoq)}</strong></>}</td>
        </tr>)}</tbody></table></div>
    </AdminCard>
    <AdminCard title="Processing status" description="A status change requires a separate RFQ management grant and an approved write source.">
      <p>Current status: <strong>{detail.status}</strong></p>
      <p>Status actions are unavailable. Viewing this inquiry does not change its status.</p>
      <div className="admin-rfq-actions"><button type="button" disabled>Mark reviewed</button>
        <button type="button" disabled>Close inquiry</button><button type="button" disabled>Reopen inquiry</button></div>
    </AdminCard>
  </div>;
}
