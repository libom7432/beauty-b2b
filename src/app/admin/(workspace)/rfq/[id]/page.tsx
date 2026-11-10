import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminBadge, AdminPageHeader } from "@/components/admin/ui";
import { RFQInboxDetailPanel } from "@/components/admin/rfq-inbox-panel";
import { serverRFQInboxRepository } from "@/lib/rfq/inbox-server";
import { RFQInboxError } from "@/lib/rfq/inbox";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
type Props = { params: Promise<{ id: string }> };
export default async function RFQInboxDetailPage({ params }: Props) {
  const repository = await serverRFQInboxRepository();
  const { id } = await params;
  let detail;
  let state: "not_connected" | "unavailable" | undefined;
  try { detail = await repository.getById(id); }
  catch (error) {
    if (error instanceof RFQInboxError && (error.code === "INVALID_INPUT" || error.code === "NOT_FOUND")) notFound();
    state = error instanceof RFQInboxError && error.code === "NOT_CONNECTED" ? "not_connected" : "unavailable";
  }
  return <><AdminPageHeader eyebrow="MERCHANT / RFQ / DETAIL" title="RFQ detail"
    description="Private, read-only inquiry details and submission-time product terms.">
    <AdminBadge tone="warning">{detail ? "Read only" : "Not connected"}</AdminBadge></AdminPageHeader>
    <p className="mb-5"><Link href="/admin/rfq" className="admin-inline-link">← Back to RFQ Inbox</Link></p>
    {detail ? <RFQInboxDetailPanel detail={detail} /> : <div className="admin-card admin-rfq-state" role="alert">
      {state === "not_connected" ? "RFQ data source not connected." : "Inquiry details are temporarily unavailable."}</div>}
  </>;
}
