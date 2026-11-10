import { AdminBadge, AdminPageHeader } from "@/components/admin/ui";

export default function Loading() {
  return <><AdminPageHeader eyebrow="MERCHANT / RFQ / DETAIL" title="RFQ detail"
    description="Private, read-only inquiry details."><AdminBadge>Loading</AdminBadge></AdminPageHeader>
    <div className="admin-card admin-rfq-state" role="status">Loading inquiry…</div></>;
}
